import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Permission, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { buildPermissionCatalogRows } from './permission-catalog';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const BOOTSTRAP_PASSWORD = process.env.SEED_BOOTSTRAP_PASSWORD ?? 'ChangeMe!2026';

/** Four POS shop roles only; old university / demo roles are removed on each seed. */
const POS_ROLE_CODES = ['ADMIN', 'MANAGER', 'BARISTA', 'CASHIER'] as const;

async function upsertPermissions() {
  const rows = buildPermissionCatalogRows();
  for (const p of rows) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        module: p.module,
        resource: p.resource,
        action: p.action,
        description: p.description ?? null,
      },
      update: {
        module: p.module,
        resource: p.resource,
        action: p.action,
        description: p.description ?? null,
      },
    });
  }
}

/** Drops roles outside the POS set (and their memberships) before re-seeding. */
async function removeObsoleteRoles() {
  const stale = await prisma.role.findMany({
    where: { code: { notIn: [...POS_ROLE_CODES] } },
    select: { id: true, code: true },
  });
  for (const r of stale) {
    await prisma.userRole.deleteMany({ where: { roleId: r.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
    await prisma.role.delete({ where: { id: r.id } });
  }
  if (stale.length) {
    console.log(
      `Removed ${stale.length} non-POS role(s):`,
      stale.map((x) => x.code).join(', '),
    );
  }
}

async function grantRolePred(
  roleId: string,
  all: Permission[],
  predicate: (p: Permission) => boolean,
  grantedBy?: string,
) {
  const picked = all.filter(predicate);
  await prisma.rolePermission.deleteMany({ where: { roleId } });
  if (picked.length === 0) return;
  await prisma.rolePermission.createMany({
    data: picked.map((perm) => ({
      roleId,
      permissionId: perm.id,
      grantedBy,
    })),
    skipDuplicates: true,
  });
}

async function main() {
  await upsertPermissions();
  await removeObsoleteRoles();

  const allPerms = await prisma.permission.findMany();

  const roleDefs = [
    { code: 'ADMIN' as const, name: 'Admin', isSystem: true },
    { code: 'MANAGER' as const, name: 'Manager', isSystem: false },
    { code: 'BARISTA' as const, name: 'Barista', isSystem: false },
    { code: 'CASHIER' as const, name: 'Cashier', isSystem: false },
  ];

  type PosRoleCode = (typeof POS_ROLE_CODES)[number];
  const roles = {} as Record<PosRoleCode, { id: string }>;

  for (const r of roleDefs) {
    const row = await prisma.role.upsert({
      where: { code: r.code },
      create: { ...r },
      update: { name: r.name, isSystem: r.isSystem },
    });
    roles[r.code as PosRoleCode] = { id: row.id };
  }

  // Admin: unchanged catalog bypass in guards + all permissions here for consistency.
  await grantRolePred(roles.ADMIN.id, allPerms, () => true);

  // Manager: Identity + KPI dashboard + Communication (staff-facing shop ops).
  await grantRolePred(
    roles.MANAGER.id,
    allPerms,
    (p) =>
      ['Identity', 'Communication'].includes(p.module) ||
      p.code === 'dashboard.read',
  );

  // Front-of-house staff: KPI read only until order/POS routes add scoped codes.
  await grantRolePred(
    roles.BARISTA.id,
    allPerms,
    (p) => p.code === 'dashboard.read',
  );
  await grantRolePred(
    roles.CASHIER.id,
    allPerms,
    (p) => p.code === 'dashboard.read',
  );

  const hash = await argon2.hash(BOOTSTRAP_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  type UserSeed = {
    email: string;
    firstName: string;
    lastName: string;
    status: UserStatus;
    roleCodes: PosRoleCode[];
  };

  const userDefs: UserSeed[] = [
    {
      email: 'admin@coffee-shop.local',
      firstName: 'Shop',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
      roleCodes: ['ADMIN'],
    },
    {
      email: 'manager@coffee-shop.local',
      firstName: 'Shift',
      lastName: 'Manager',
      status: UserStatus.ACTIVE,
      roleCodes: ['MANAGER'],
    },
    {
      email: 'barista@coffee-shop.local',
      firstName: 'Alex',
      lastName: 'Barista',
      status: UserStatus.ACTIVE,
      roleCodes: ['BARISTA'],
    },
    {
      email: 'cashier@coffee-shop.local',
      firstName: 'Jamie',
      lastName: 'Cashier',
      status: UserStatus.ACTIVE,
      roleCodes: ['CASHIER'],
    },
  ];

  const keepEmails = userDefs.map((u) => u.email.toLowerCase());

  await prisma.refreshToken.deleteMany({
    where: { user: { email: { notIn: keepEmails } } },
  });
  await prisma.user.deleteMany({
    where: {
      deletedAt: null,
      email: { notIn: keepEmails },
    },
  });

  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: u.email.toLowerCase() },
      create: {
        email: u.email.toLowerCase(),
        firstName: u.firstName,
        lastName: u.lastName,
        passwordHash: hash,
        status: u.status,
      },
      update: {
        firstName: u.firstName,
        lastName: u.lastName,
        passwordHash: hash,
        status: u.status,
        deletedAt: null,
      },
    });

    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    for (const rc of u.roleCodes) {
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: roles[rc].id,
        },
      });
    }

    // if (u.scope !== undefined) {
    //   await prisma.userScope.upsert({
    //     where: { userId: user.id },
    //     create: {
    //       userId: user.id,
    //       campusIds: u.scope.campusIds,
    //       departmentIds: u.scope.departmentIds,
    //     },
    //     update: {
    //       campusIds: u.scope.campusIds,
    //       departmentIds: u.scope.departmentIds,
    //     },
    //   });
    // } else {
    //   await prisma.userScope.deleteMany({ where: { userId: user.id } });
    // }

    console.log(`Seeded user ${u.email} (${u.roleCodes.join('+')})`);
  }

  console.log('✓ POS RBAC seed done. Password:', BOOTSTRAP_PASSWORD);
  console.log('  ADMIN login:', userDefs.find((x) => x.roleCodes.includes('ADMIN'))?.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
