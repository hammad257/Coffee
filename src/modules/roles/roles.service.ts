import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionInvalidationService } from '../../common/services/session-invalidation.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionInvalidationService,
  ) {}

  async findAll(page = 1, limit = 50) {
    const take = Math.min(100, Math.max(1, limit));
    const skip = (Math.max(1, page) - 1) * take;
    const [total, roles] = await Promise.all([
      this.prisma.role.count(),
      this.prisma.role.findMany({
        skip,
        take,
        orderBy: { code: 'asc' },
        include: {
          _count: {
            select: { userRoles: true, rolePermissions: true },
          },
        },
      }),
    ]);

    return {
      page,
      limit: take,
      total,
      items: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        userCount: r._count.userRoles,
        permissionCount: r._count.rolePermissions,
      })),
    };
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        module: rp.permission.module,
        resource: rp.permission.resource,
        action: rp.permission.action,
      })),
    };
  }

  async create(dto: CreateRoleDto) {
    try {
      return await this.prisma.role.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          isSystem: false,
        },
      });
    } catch {
      throw new ConflictException('Role code already exists.');
    }
  }

  async update(id: string, dto: UpdateRoleDto) {
    const existing = await this.prisma.role.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role not found');
    if (
      dto.code !== undefined &&
      existing.isSystem &&
      dto.code !== existing.code
    ) {
      throw new ForbiddenException(
        'Cannot change code of a system role.',
      );
    }
    await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
      },
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!existing) throw new NotFoundException('Role not found');
    if (existing.isSystem)
      throw new ForbiddenException('Cannot delete a system role.');
    if (existing._count.userRoles > 0) {
      throw new ConflictException(
        'Role is assigned to users; reassign users first.',
      );
    }

    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }

  async setPermissions(
    actorId: string,
    roleId: string,
    dto: SetRolePermissionsDto,
  ) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Role not found');

    await this.ensurePermissionIds(dto.permissionIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (dto.permissionIds.length === 0) return;
      await tx.rolePermission.createMany({
        data: dto.permissionIds.map((permissionId) => ({
          roleId,
          permissionId,
          grantedBy: actorId,
        })),
      });
    });

    await this.sessions.invalidateUsersWithRole(roleId);
    return this.findOne(roleId);
  }

  private async ensurePermissionIds(ids: string[]) {
    const found = await this.prisma.permission.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new ConflictException('One or more permission IDs are invalid.');
    }
  }
}
