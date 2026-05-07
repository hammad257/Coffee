import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ADMIN_FULL_ACCESS_ROLE } from '../constants/roles';
import type { AuthUser } from '../types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions?.length) return true;

    const request = context.switchToHttp().getRequest<
      Request & { user?: AuthUser }
    >();

    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated.');
    }

    const roles = user.roles ?? [];
    const permissions = user.permissions ?? [];

    // 🔥 SUPER ADMIN BYPASS
    if (roles.includes(ADMIN_FULL_ACCESS_ROLE)) {
      return true;
    }

    const missing = requiredPermissions.filter(
      (p) => !permissions.includes(p),
    );

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Access denied. Missing: ${missing.join(', ')}`,
      );
    }

    return true;
  }
}