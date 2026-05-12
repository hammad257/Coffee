import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';
import {
  isLegacyJwtPayload,
  type AuthUser,
  type JwtAccessPayload,
} from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { parseDurationToMs } from './time.util';
import type { LoginDto, SignupDto } from './dto/auth.dto';

const userAuthInclude = {
  userRoles: {
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithAuth = Prisma.UserGetPayload<{ include: typeof userAuthInclude }>;

const userSelectMini = {
  id: true,
  tokenVersion: true,
  status: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async validateAccessTokenClaims(
    payload: unknown,
  ): Promise<AuthUser | null> {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Partial<JwtAccessPayload> & { sub?: string; tv?: unknown };

    const sub = p.sub;
    if (!sub) return null;

    const tv =
      typeof p.tv === 'number'
        ? p.tv
        : Number.parseInt(String(p.tv), 10);
    if (!Number.isFinite(tv)) return null;

    const row = await this.prisma.user.findFirst({
      where: { id: sub, deletedAt: null },
      select: userSelectMini,
    });
    if (!row || row.status !== UserStatus.ACTIVE) return null;
    if (row.tokenVersion !== tv) return null;

    if (isLegacyJwtPayload(payload)) {
      const full = await this.prisma.user.findFirst({
        where: { id: sub, deletedAt: null },
        include: userAuthInclude,
      });
      return full ? this.toAuthUser(full) : null;
    }

    // const scope: AuthScope = {
    //   campusIds:
    //     p.scope && Array.isArray((p.scope as AuthScope).campusIds)
    //       ? ([...(p.scope as AuthScope).campusIds] as string[])
    //       : [],
    //   departmentIds:
    //     p.scope && Array.isArray((p.scope as AuthScope).departmentIds)
    //       ? ([...(p.scope as AuthScope).departmentIds] as string[])
    //       : [],
    // };

    return {
      id: sub,
      email: typeof p.email === 'string' ? p.email : '',
      firstName: typeof p.firstName === 'string' ? p.firstName : '',
      lastName: typeof p.lastName === 'string' ? p.lastName : '',
      roles: Array.isArray(p.roles) ? [...p.roles] as string[] : [],
      permissions: Array.isArray(p.permissions)
        ? [...p.permissions] as string[]
        : [],
    };
  }

  async getAuthUserById(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: userAuthInclude,
    });
    if (!user || user.status !== UserStatus.ACTIVE) return null;
    return this.toAuthUser(user);
  }

  async login(dto: LoginDto, req: Request) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
        deletedAt: null,
      },
      include: userAuthInclude,
    });

    const invalid = () =>
      new UnauthorizedException('Invalid email or password.');

    if (!user) throw invalid();
    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException('Account pending activation.');
    }
    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('Account inactive.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account not active.');
    }

    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw invalid();

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = this.signAccessTokenFromDbUser(user);
    const refreshToken = await this.issueRefreshToken(
      user,
      dto.rememberMe ?? false,
      req,
    );

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUser(user),
    };
  }

  /**
   * Self-service registration for POS roles. Roles listed in `SIGNUP_REQUIRE_APPROVAL_FOR`
   * (default ADMIN,MANAGER) get `PENDING` until an admin activates the account.
   */
  async signup(dto: SignupDto, req: Request) {
    const disabled =
      this.config.get<string>('SIGNUP_ENABLED')?.toLowerCase() === 'false';
    if (disabled) {
      throw new ForbiddenException('Self-service signup is disabled.');
    }

    const roleCode = dto.roleCode;

    const approvalCsv =
      this.config.get<string>('SIGNUP_REQUIRE_APPROVAL_FOR') ??
      'ADMIN,MANAGER';
    const pendingCodes = new Set(
      approvalCsv
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    );
    const status = pendingCodes.has(roleCode)
      ? UserStatus.PENDING
      : UserStatus.ACTIVE;

    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
      select: { id: true, code: true },
    });
    if (!role) {
      throw new BadRequestException(
        `Role "${roleCode}" is not available. Run DB seed so ADMIN, MANAGER, BARISTA, and CASHIER exist.`,
      );
    }

    const dup = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException('Email already registered.');
    }

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
        status,
        createdById: null,
        userRoles: {
          create: [{ roleId: role.id }],
        },
      },
      include: userAuthInclude,
    });

    if (status === UserStatus.PENDING) {
      return {
        pendingActivation: true,
        message:
          'Account created. An administrator must activate your account before you can sign in.',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          status: user.status,
          roleCodes: [role.code],
        },
      };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = this.signAccessTokenFromDbUser(user);
    const refreshToken = await this.issueRefreshToken(
      user,
      dto.rememberMe ?? false,
      req,
    );

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUser(user),
    };
  }

  async refresh(refreshTokenRaw: string, req: Request) {
    const tokenHash = this.hashToken(refreshTokenRaw);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!row) throw new UnauthorizedException('Invalid refresh token.');

    const user = await this.prisma.user.findFirst({
      where: { id: row.userId, deletedAt: null },
      include: userAuthInclude,
    });

    if (!user) throw new UnauthorizedException('Invalid refresh token.');

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account not active.');
    }

    if (row.revokedAt) {
      await this.revokeAllRefreshSessions(user.id);
      throw new UnauthorizedException('Session revoked. Please sign in again.');
    }

    if (row.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    const newRaw = this.generateRawRefreshToken();
    const newHash = this.hashToken(newRaw);
    const expiresAt = this.computeRefreshExpiry(row.rememberMe);

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newHash,
          expiresAt,
          userAgent: userAgentFromReq(req),
          ipAddress: ipFromReq(req),
          rememberMe: row.rememberMe,
        },
      });

      await tx.refreshToken.update({
        where: { id: row.id },
        data: {
          revokedAt: new Date(),
          replacedBy: created.id,
        },
      });
    });

    const accessToken = this.signAccessTokenFromDbUser(user);

    return { accessToken, refreshToken: newRaw };
  }

  async logout(userId: string, refreshTokenRaw: string | undefined) {
    if (refreshTokenRaw) {
      const tokenHash = this.hashToken(refreshTokenRaw);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }

  private async revokeAllRefreshSessions(userId: string) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }

  private signAccessTokenFromDbUser(user: UserWithAuth): string {
    const profile = this.toAuthUser(user);
    return this.jwt.sign({
      sub: user.id,
      tv: user.tokenVersion,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      roles: profile.roles,
      permissions: profile.permissions,
    });
  }

  private async issueRefreshToken(
    user: UserWithAuth,
    rememberMe: boolean,
    req: Request,
  ): Promise<string> {
    const raw = this.generateRawRefreshToken();
    const tokenHash = this.hashToken(raw);
    const expiresAt = this.computeRefreshExpiry(rememberMe);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        rememberMe,
        userAgent: userAgentFromReq(req),
        ipAddress: ipFromReq(req),
      },
    });

    return raw;
  }

  private computeRefreshExpiry(rememberMe: boolean): Date {
    const longMs = parseDurationToMs('30d');
    const cfg = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const shortMs = parseDurationToMs(cfg);
    const ms = rememberMe ? longMs : shortMs;
    return new Date(Date.now() + ms);
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  private generateRawRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  toAuthUser(user: UserWithAuth): AuthUser {
    const roles = [...new Set(user.userRoles.map((ur) => ur.role.code))];
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    ].sort();

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      permissions,
      // scope: {
      //   campusIds: user.scope?.campusIds?.length ? [...user.scope.campusIds] : [],
      //   departmentIds: user.scope?.departmentIds?.length
      //     ? [...user.scope.departmentIds]
      //     : [],
      // },
    };
  }
}

function userAgentFromReq(req: Request): string | undefined {
  const h = req.headers['user-agent'];
  return typeof h === 'string' ? h : undefined;
}

function ipFromReq(req: Request): string | undefined {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string') {
    return xf.split(',')[0]?.trim();
  }
  return req.socket?.remoteAddress ?? undefined;
}
