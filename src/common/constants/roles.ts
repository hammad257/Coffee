/**
 * Protected full-access shop role (`roles.code`). Skips `@Roles()` /
 * `@Permissions()` where guards check this constant; UsersService refuses to leave
 * zero ACTIVE users with this role.
 */
export const ADMIN_FULL_ACCESS_ROLE = 'ADMIN';
