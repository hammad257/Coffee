import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, limit = 200) {
    const take = Math.min(500, Math.max(1, limit));
    const skip = (Math.max(1, page) - 1) * take;

    const [total, rows] = await Promise.all([
      this.prisma.permission.count(),
      this.prisma.permission.findMany({
        skip,
        take,
        orderBy: [{ module: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
      }),
    ]);

    return { page, limit: take, total, items: rows };
  }

  /** Matrix shape: module → resources → action codes (for UI grids). */
  async grouped(): Promise<{
    modules: {
      module: string;
      resources: { resource: string; actions: string[] }[];
    }[];
  }> {
    const all = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
    });

    type ResMap = Map<string, Set<string>>;
    const byModule = new Map<string, ResMap>();

    for (const p of all) {
      if (!byModule.has(p.module)) byModule.set(p.module, new Map());
      const resMap = byModule.get(p.module)!;
      if (!resMap.has(p.resource)) resMap.set(p.resource, new Set());
      resMap.get(p.resource)!.add(p.action);
    }

    const modules = [...byModule.entries()].map(([module, resMap]) => ({
      module,
      resources: [...resMap.entries()].map(([resource, actions]) => ({
        resource,
        actions: [...actions].sort(),
      })),
    }));

    return { modules };
  }
}
