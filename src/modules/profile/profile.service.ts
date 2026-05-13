import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { UserActivityType, UserStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { SessionInvalidationService } from '../../common/services/session-invalidation.service';
import { LocalFilesService } from '../../common/upload/local-files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListMyActivityQueryDto, PatchMyProfileDto } from './dto/profile.dto';

const profileInclude = {
  userRoles: { include: { role: true } },
} satisfies Prisma.UserInclude;

type ProfUser = Prisma.UserGetPayload<{ include: typeof profileInclude }>;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localFiles: LocalFilesService,
    private readonly auth: AuthService,
    private readonly sessions: SessionInvalidationService,
  ) {}

  async getMyProfile(userId: string) {
    const u = await this.requireUser(userId);
    const authRow = await this.auth.getAuthUserById(userId);
    return this.serialize(u, authRow?.permissions ?? []);
  }

  private async requireUser(id: string): Promise<ProfUser> {
    const u = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: profileInclude,
    });
    if (!u) throw new NotFoundException('User not found.');
    return u;
  }

  private serialize(u: ProfUser, permissionCodes: string[]) {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      photoUrl: this.localFiles.toAbsoluteAssetUrl(u.photoUrl),
      phone: u.phone,
      bio: u.bio,
      jobTitle: u.jobTitle,
      workLocation: u.workLocation,
      notificationFrequency: u.notificationFrequency,
      systemLanguage: u.systemLanguage,
      twoFactorEnabled: u.twoFactorEnabled,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      roles: u.userRoles.map((ur) => ({
        id: ur.role.id,
        code: ur.role.code,
        name: ur.role.name,
      })),
      permissions: permissionCodes,
    };
  }

  async patchMyProfile(userId: string, dto: PatchMyProfileDto) {
    const u = await this.requireUser(userId);
    if (u.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active.');
    }

    if (dto.email !== undefined && dto.email !== u.email) {
      const taken = await this.prisma.user.findFirst({
        where: {
          email: { equals: dto.email, mode: 'insensitive' },
          deletedAt: null,
          NOT: { id: userId },
        },
      });
      if (taken) throw new ConflictException('Email already in use.');
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle;
    if (dto.workLocation !== undefined) data.workLocation = dto.workLocation;
    if (dto.notificationFrequency !== undefined)
      data.notificationFrequency = dto.notificationFrequency;
    if (dto.systemLanguage !== undefined)
      data.systemLanguage = dto.systemLanguage;
    if (dto.twoFactorEnabled !== undefined)
      data.twoFactorEnabled = dto.twoFactorEnabled;

    const jwtIdentityChanged =
      (dto.email !== undefined && dto.email !== u.email) ||
      (dto.firstName !== undefined && dto.firstName !== u.firstName) ||
      (dto.lastName !== undefined && dto.lastName !== u.lastName);

    if (jwtIdentityChanged) {
      data.tokenVersion = { increment: 1 };
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data,
      });
    }

    await this.prisma.userActivity.create({
      data: {
        userId,
        activityType: UserActivityType.PROFILE_UPDATED,
        title: 'Profile updated',
        meta: { fields: Object.keys(dto) } as Prisma.InputJsonValue,
      },
    });

    if (jwtIdentityChanged) {
      await this.sessions.invalidateUser(userId);
    }

    const fresh = await this.requireUser(userId);
    const authRow = await this.auth.getAuthUserById(userId);
    return {
      ...this.serialize(fresh, authRow?.permissions ?? []),
      reauthRequired: jwtIdentityChanged,
      ...(jwtIdentityChanged
        ? {
            message:
              'Identity on your access token changed — log in again for a new token.',
          }
        : {}),
    };
  }

  async listMyActivity(userId: string, q: ListMyActivityQueryDto) {
    const limit = Math.min(50, Math.max(1, q.limit ?? 20));
    const rows = await this.prisma.userActivity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        activityType: true,
        title: true,
        detail: true,
        meta: true,
        createdAt: true,
      },
    });
    return { limit, returned: rows.length, items: rows };
  }
}
