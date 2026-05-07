/** Canonical POS shop role codes (`roles.code`). `ADMIN` is full-access / protected. */
export enum RoleCode {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  BARISTA = 'BARISTA',
  CASHIER = 'CASHIER',
}


/** Full JWT access payload after Module 2 (signature + expiry verified by passport). */
export interface JwtAccessPayload {
  sub: string;
  tv: number;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}

/** Attached to `req.user` after JWT validation. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
}

/** True when token issued before Module 2 migration (only `sub` + `tv`). */
export function isLegacyJwtPayload(
  payload: unknown,
): payload is { sub: string; tv: number } {
  if (!payload || typeof payload !== 'object') return true;
  const p = payload as Record<string, unknown>;
  return !Array.isArray(p.roles) || !Array.isArray(p.permissions);
}
