import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ADMIN_FULL_ACCESS_ROLE } from '../constants/roles';
import type { AuthUser } from '../types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<
      Request & { user?: AuthUser }
    >();
    const user = request.user;

    if (!user?.roles?.length) {
      throw new ForbiddenException('Access denied.');
    }

    if (user.roles.includes(ADMIN_FULL_ACCESS_ROLE)) {
      return true;
    }

    const hasRole = user.roles.some((role) =>
      requiredRoles.includes(role),
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
