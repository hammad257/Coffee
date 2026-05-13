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

  // Manager: full POS + Identity + dashboard.
  await grantRolePred(
    roles.MANAGER.id,
    allPerms,
    (p) =>
      ['Identity', 'Coffee'].includes(p.module) ||
      p.code === 'dashboard.read',
  );

  // Barista: floor + kitchen workflow — read/update orders, read menu, read tables & stats.
  await grantRolePred(
    roles.BARISTA.id,
    allPerms,
    (p) =>
      p.code === 'dashboard.read' ||
      (p.module === 'Coffee' &&
        ((p.resource === 'order' &&
          [
            'read',
            'create',
            'update',
            'update_status',
            'hold',
            'complete',
          ].includes(p.action)) ||
          (p.resource === 'product' && p.action === 'read') ||
          (p.resource === 'category' && p.action === 'read') ||
          (p.resource === 'table' && p.action === 'read') ||
          (p.resource === 'stats' && p.action === 'read') ||
          (p.resource === 'settings' && p.action === 'read'))),
  );

  // Cashier: checkout & register — all order/table/stats; catalog read-only; no product/category delete.
  await grantRolePred(
    roles.CASHIER.id,
    allPerms,
    (p) =>
      p.code === 'dashboard.read' ||
      (p.module === 'Coffee' &&
        !(
          (p.resource === 'product' && p.action === 'delete') ||
          (p.resource === 'category' && p.action === 'delete') ||
          (p.resource === 'settings' && p.action === 'update')
        )),
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

  await seedCatalogAndTables();
}

async function seedCatalogAndTables() {
  const coffee = await prisma.productCategory.upsert({
    where: { slug: 'coffee' },
    create: {
      name: 'Coffee',
      slug: 'coffee',
      sortOrder: 10,
      isActive: true,
    },
    update: { name: 'Coffee' },
  });
  const snacks = await prisma.productCategory.upsert({
    where: { slug: 'snacks' },
    create: {
      name: 'Snacks',
      slug: 'snacks',
      sortOrder: 20,
      isActive: true,
    },
    update: {},
  });

  const demo: {
    sku: string;
    name: string;
    price: string;
    categoryId: string;
    description?: string;
    outOfStock?: boolean;
  }[] = [
    {
      sku: 'MENU-FW-001',
      name: 'Flat White',
      price: '4.50',
      categoryId: coffee.id,
      description: 'Creamy microfoam',
    },
    {
      sku: 'MENU-ESP-002',
      name: 'Espresso',
      price: '3.25',
      categoryId: coffee.id,
      description: 'Double shot',
    },
    {
      sku: 'MENU-CM-003',
      name: 'Caramel Macchiato',
      price: '5.50',
      categoryId: coffee.id,
      description: 'Sweet & cold',
    },
    {
      sku: 'MENU-CB-004',
      name: 'Cold Brew',
      price: '4.75',
      categoryId: coffee.id,
      description: 'Slow steeped',
      outOfStock: true,
    },
    {
      sku: 'MENU-CR-005',
      name: 'Butter Croissant',
      price: '3.50',
      categoryId: snacks.id,
      description: 'Warmed',
    },
  ];

  for (const p of demo) {
    const existing = await prisma.product.findFirst({
      where: { name: p.name, categoryId: p.categoryId },
    });
    if (existing) continue;
    await prisma.product.create({
      data: {
        sku: p.sku,
        categoryId: p.categoryId,
        name: p.name,
        description: p.description ?? null,
        price: p.price,
        outOfStock: p.outOfStock ?? false,
      },
    });
  }

  const demoStockPatches: Record<
    string,
    {
      stockQuantity: number;
      lowStockThreshold: number;
      outOfStock?: boolean;
    }
  > = {
    'Flat White': { stockQuantity: 80, lowStockThreshold: 15 },
    Espresso: { stockQuantity: 8, lowStockThreshold: 10 },
    'Caramel Macchiato': { stockQuantity: 20, lowStockThreshold: 5 },
    'Cold Brew': {
      stockQuantity: 0,
      lowStockThreshold: 5,
      outOfStock: true,
    },
    'Butter Croissant': { stockQuantity: 20, lowStockThreshold: 8 },
  };
  for (const [name, patch] of Object.entries(demoStockPatches)) {
    await prisma.product.updateMany({
      where: { name },
      data: {
        stockQuantity: patch.stockQuantity,
        lowStockThreshold: patch.lowStockThreshold,
        ...(patch.outOfStock !== undefined
          ? { outOfStock: patch.outOfStock }
          : {}),
      },
    });
  }

  const labels = [
    'T-01',
    'T-02',
    'T-03',
    'T-04',
    'T-05',
    'T-06',
    'T-07',
    'T-08',
    'T-09',
    'T-10',
  ];
  for (const label of labels) {
    await prisma.dineTable.upsert({
      where: { label },
      create: { label, capacity: 4 },
      update: {},
    });
  }

  console.log('✓ Seeded categories, demo products, and dine-in tables (T-01…T-10).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
