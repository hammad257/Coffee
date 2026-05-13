import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { UserStatus, UserActivityType, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import type { Express } from 'express';
import type { AuthUser } from '../../common/types';
import { SessionInvalidationService } from '../../common/services/session-invalidation.service';
import { LocalFilesService } from '../../common/upload/local-files.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AssignUserRolesDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserPasswordDto,
} from './dto/user.dto';

type UserListRow = Prisma.UserGetPayload<{
  include: { userRoles: { include: { role: true } } };
}>;

@Injectable()
export class UsersService {
  private principalAdminRoleIdMemo: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionInvalidationService,
    private readonly localFiles: LocalFilesService,
  ) {}

  private async principalAdminRoleId(): Promise<string> {
    if (!this.principalAdminRoleIdMemo) {
      this.principalAdminRoleIdMemo = this.prisma.role
        .findUniqueOrThrow({ where: { code: 'ADMIN' } })
        .then((r) => r.id);
    }
    return this.principalAdminRoleIdMemo;
  }

  private async userHasRole(userId: string, roleId: string): Promise<boolean> {
    const row = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId } },
    });
    return !!row;
  }

  private async countActivePrincipalAdminsExclude(
    excludeUserId?: string,
  ): Promise<number> {
    const adminRoleId = await this.principalAdminRoleId();
    const rows = await this.prisma.userRole.findMany({
      where: { roleId: adminRoleId },
      select: {
        userId: true,
        user: {
          select: { id: true, status: true, deletedAt: true },
        },
      },
    });
    return rows.filter(
      (r) =>
        r.user.deletedAt == null &&
        r.user.status === UserStatus.ACTIVE &&
        r.user.id !== excludeUserId,
    ).length;
  }

  async listActors(q: ListUsersQueryDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.roleId
        ? { userRoles: { some: { roleId: q.roleId } } }
        : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { email: { contains: q.search.trim(), mode: 'insensitive' } },
              {
                firstName: {
                  contains: q.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                lastName: {
                  contains: q.search.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          userRoles: { include: { role: true } },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      items: rows.map((u) => this.serializeUserSummary(u)),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        userRoles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const permCodes = await this.effectivePermissionsForUser(user.id);
    return {
      ...this.serializeUserSummary(user),
      // scope: user.scope
      //   ? {
      //       campusIds: user.scope.campusIds,
      //       departmentIds: user.scope.departmentIds,
      //     }
      //   : { campusIds: [], departmentIds: [] },
      permissions: permCodes,
    };
  }

  async effectivePermissions(userId: string) {
    return { permissions: await this.effectivePermissionsForUser(userId) };
  }

  private async effectivePermissionsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.permission.findMany({
      where: {
        rolePermissions: {
          some: {
            role: { userRoles: { some: { userId } } },
          },
        },
      },
      select: { code: true },
      distinct: ['code'],
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => r.code);
  }

  async create(actorId: string, dto: CreateUserDto) {
    await this.ensureRoleIdsExist(dto.roleIds);
    const dup = await this.prisma.user.findFirst({
      where: { email: { equals: dto.email, mode: 'insensitive' } },
    });
    if (dup) throw new ConflictException('Email already in use');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        status: dto.status ?? UserStatus.PENDING,
        photoUrl: dto.photoUploadId ?? null,
        createdById: actorId,
        userRoles: {
          create: dto.roleIds.map((rid) => ({
            roleId: rid,
            assignedBy: actorId,
          })),
        },
      },
      include: {
        userRoles: { include: { role: true } },
      },
    });

    return this.serializeUserSummary(user);
  }

  async updateProfilePhoto(
    userId: string,
    file: Express.Multer.File | undefined,
    actorId: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Image file is required (multipart field name: file).',
      );
    }
    await this.requireUser(userId);
    const prev = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { photoUrl: true },
    });
    this.localFiles.removeManagedFile(prev?.photoUrl);
    const publicPath = this.localFiles.publicPath('users', file.filename);
    await this.prisma.user.update({
      where: { id: userId },
      data: { photoUrl: publicPath, updatedById: actorId },
    });
    return this.findOne(userId);
  }

  async update(actorId: string, id: string, dto: UpdateUserDto) {
    const existing = await this.requireUser(id);
    if (
      dto.status !== undefined &&
      actorId === id &&
      dto.status !== existing.status
    ) {
      throw new ForbiddenException('You cannot change your own status.');
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      const adminRoleId = await this.principalAdminRoleId();
      const wasAdmin = await this.userHasRole(id, adminRoleId);
      if (wasAdmin && dto.status !== UserStatus.ACTIVE) {
        const others = await this.countActivePrincipalAdminsExclude(id);
        if (others < 1) {
          throw new ForbiddenException(
            'Cannot deactivate the last active Admin.',
          );
        }
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.photoUploadId !== undefined
          ? { photoUrl: dto.photoUploadId || null }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle } : {}),
        ...(dto.workLocation !== undefined
          ? { workLocation: dto.workLocation }
          : {}),
        ...(dto.notificationFrequency !== undefined
          ? { notificationFrequency: dto.notificationFrequency }
          : {}),
        ...(dto.systemLanguage !== undefined
          ? { systemLanguage: dto.systemLanguage }
          : {}),
        ...(dto.twoFactorEnabled !== undefined
          ? { twoFactorEnabled: dto.twoFactorEnabled }
          : {}),
        updatedById: actorId,
      },
    });

    return this.findOne(id);
  }

  async assignRoles(actorId: string, id: string, dto: AssignUserRolesDto) {
    if (actorId === id) {
      throw new ForbiddenException(
        'You cannot change your own roles. Ask another admin.',
      );
    }
    await this.requireUser(id);
    await this.ensureRoleIdsExist(dto.roleIds);

    const adminRoleId = await this.principalAdminRoleId();
    const currentlyAdmin = await this.userHasRole(id, adminRoleId);
    const willBeAdmin = dto.roleIds.includes(adminRoleId);

    if (currentlyAdmin && !willBeAdmin) {
      const others = await this.countActivePrincipalAdminsExclude(id);
      if (others < 1) {
        throw new ForbiddenException(
          'Cannot remove Admin from the last Admin user.',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      if (dto.roleIds.length) {
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            userId: id,
            roleId,
            assignedBy: actorId,
          })),
        });
      }
    });

    await this.sessions.invalidateUser(id);
    return this.findOne(id);
  }

  // async updateScope(actorId: string, id: string, dto: UpdateUserScopeDto) {
  //   if (actorId === id) {
  //     throw new ForbiddenException(
  //       'You cannot change your own scope. Ask another admin.',
  //     );
  //   }
  //   await this.requireUser(id);

  //   await this.prisma.userScope.upsert({
  //     where: { userId: id },
  //     create: {
  //       userId: id,
  //       campusIds: dto.campusIds,
  //       departmentIds: dto.departmentIds,
  //     },
  //     update: {
  //       campusIds: dto.campusIds,
  //       departmentIds: dto.departmentIds,
  //     },
  //   });

  //   await this.sessions.invalidateUser(id);
  //   return this.findOne(id);
  // }

  async updatePassword(
    actor: AuthUser,
    id: string,
    dto: UpdateUserPasswordDto,
  ) {
    const existing = await this.requireUser(id);
    const self = actor.id === id;

    if (self) {
      if (!dto.currentPassword) {
        throw new ForbiddenException('Current password required.');
      }
      const ok = await argon2.verify(
        existing.passwordHash,
        dto.currentPassword,
      );
      if (!ok)
        throw new UnauthorizedException('Current password is incorrect.');
    }

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        updatedById: actor.id,
      },
    });

    await this.prisma.userActivity.create({
      data: {
        userId: id,
        activityType: UserActivityType.PASSWORD_CHANGED,
        title: self ? 'Password changed' : 'Password reset by administrator',
      },
    });

    await this.sessions.invalidateUser(id);
    return { ok: true };
  }

  async remove(actorId: string, id: string) {
    if (actorId === id)
      throw new ForbiddenException('You cannot delete your own account.');

    await this.requireUser(id);
    const adminRoleId = await this.principalAdminRoleId();
    if (await this.userHasRole(id, adminRoleId)) {
      const others = await this.countActivePrincipalAdminsExclude(id);
      if (others < 1) {
        throw new ForbiddenException('Cannot delete the last Admin.');
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        email: `deleted.${id}.${Date.now()}@removed.invalid`,
        updatedById: actorId,
      },
    });

    await this.sessions.invalidateUser(id);
    return { ok: true };
  }

  private async requireUser(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  private async ensureRoleIdsExist(roleIds: string[]) {
    const found = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true },
    });
    if (found.length !== roleIds.length) {
      throw new ConflictException('One or more role IDs are invalid.');
    }
  }

  private serializeUserSummary(u: UserListRow) {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      bio: u.bio,
      jobTitle: u.jobTitle,
      workLocation: u.workLocation,
      notificationFrequency: u.notificationFrequency,
      systemLanguage: u.systemLanguage,
      twoFactorEnabled: u.twoFactorEnabled,
      photoUrl: this.localFiles.toAbsoluteAssetUrl(u.photoUrl),
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.userRoles.map((ur) => ({
        id: ur.role.id,
        code: ur.role.code,
        name: ur.role.name,
      })),
    };
  }
}
