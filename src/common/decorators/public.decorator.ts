import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks an endpoint as publicly accessible (skips JwtAuthGuard).
 * Pair with `@Public()` on routes like /auth/login, /auth/refresh,
 * /admission/apply, etc.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
