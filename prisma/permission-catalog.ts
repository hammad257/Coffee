/** Standard CRUD-ish actions permission codes suffixes (before dot prefix). */
export const STANDARD_ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
] as const;

export interface PermissionSeedRow {
  code: string;
  module: string;
  resource: string;
  action: string;
  description?: string;
}

/** Format: `<module>.<resource>.<action>` (all lower-case segments). */
export function permCode(
  module: string,
  resource: string,
  action: string,
): string {
  return `${module.toLowerCase()}.${resource.toLowerCase()}.${action.toLowerCase()}`;
}

type ResourceMap = Record<string, readonly string[]>;

const PERMISSION_GROUPS: { module: string; resources: ResourceMap }[] = [
  {
    module: 'Identity',
    resources: {
      user: [...STANDARD_ACTIONS],
      role: [...STANDARD_ACTIONS],
      permission: ['read'],
    },
  },
  {
    module: 'Coffee',
    resources: {
      order: [...STANDARD_ACTIONS, 'update_status', 'hold', 'complete'],
      product: [...STANDARD_ACTIONS],
      category: [...STANDARD_ACTIONS],
      table: ['read', 'create', 'update', 'delete'],
      stats: ['read'],
      settings: ['read', 'update'],
    },
  },
];

/** Legacy / app-specific codes (outside the matrix naming). */
export const EXTRA_PERMISSIONS: PermissionSeedRow[] = [
  {
    code: 'dashboard.read',
    module: 'Coffee',
    resource: 'dashboard',
    action: 'read',
    description: 'Manager dashboard KPI (coffee POS demo)',
  },
];

/** Flatten matrix → seed rows */
export function buildPermissionCatalogRows(): PermissionSeedRow[] {
  const out: PermissionSeedRow[] = [];
  for (const { module, resources } of PERMISSION_GROUPS) {
    for (const [resource, actions] of Object.entries(resources)) {
      for (const action of actions) {
        out.push({
          code: permCode(module, resource, action),
          module,
          resource,
          action,
        });
      }
    }
  }
  out.push(...EXTRA_PERMISSIONS);
  return out;
}
