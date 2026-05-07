import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SessionInvalidationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Revoke refresh tokens + bump tokenVersion — invalidates access JWT immediately. */
  async invalidateUsers(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    await Promise.all(unique.map((id) => this.invalidateUser(id)));
  }

  async invalidateUser(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }

  /** After role.permissions change — force re-login for all users holding that role. */
  async invalidateUsersWithRole(roleId: string): Promise<void> {
    const rows = await this.prisma.userRole.findMany({
      where: { roleId },
      distinct: ['userId'],
      select: { userId: true },
    });
    await this.invalidateUsers(rows.map((r) => r.userId));
  }
}
