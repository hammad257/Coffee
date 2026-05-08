import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto/catalog.dto';
import type {
  StockAlertsQueryDto,
  TopSellingProductsQueryDto,
} from './dto/dashboard.dto';
import D from 'decimal.js';

function money(v: unknown): number {
  return Number(v);
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Categories ---

  async listCategories() {
    return this.prisma.productCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    try {
      return await this.prisma.productCategory.create({
        data: {
          name: dto.name,
          slug: dto.slug.toLowerCase(),
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Category slug already exists.');
      }
      throw e;
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    await this.requireCategory(id);
    try {
      return await this.prisma.productCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug.toLowerCase() } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Category slug already exists.');
      }
      throw e;
    }
  }

  async removeCategory(id: string) {
    await this.requireCategory(id);
    const inUse = await this.prisma.product.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw new ConflictException('Category has products; reassign or delete them first.');
    }
    await this.prisma.productCategory.delete({ where: { id } });
    return { ok: true };
  }

  private async requireCategory(id: string) {
    const c = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Category not found');
    return c;
  }

  // --- Products ---

  async listProducts(q: ListProductsQueryDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { name: { contains: q.search.trim(), mode: 'insensitive' } },
              {
                description: {
                  contains: q.search.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { category: true },
      }),
    ]);

    return {
      page,
      limit,
      total,
      data: rows.map((p) => this.serializeProduct(p)),
    };
  }

  async getProduct(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!p) throw new NotFoundException('Product not found');
    return this.serializeProduct(p);
  }

  async createProduct(dto: CreateProductDto) {
    await this.requireCategory(dto.categoryId);
    const p = await this.prisma.product.create({
      data: {
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description ?? null,
        price: new D(dto.price).toFixed(2),
        imageUrl: dto.imageUrl ?? null,
        outOfStock: dto.outOfStock ?? false,
        isActive: dto.isActive ?? true,
        stockQuantity: dto.stockQuantity ?? 500,
        lowStockThreshold: dto.lowStockThreshold ?? 10,
      },
      include: { category: true },
    });
    return this.serializeProduct(p);
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.requireProduct(id);
    if (dto.categoryId) await this.requireCategory(dto.categoryId);
    const p = await this.prisma.product.update({
      where: { id },
      data: this.buildProductUpdate(dto),
      include: { category: true },
    });
    return this.serializeProduct(p);
  }

  async removeProduct(id: string) {
    await this.requireProduct(id);
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  private async requireProduct(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  private buildProductUpdate(
    dto: UpdateProductDto,
  ): Prisma.ProductUncheckedUpdateInput {
    const data: Prisma.ProductUncheckedUpdateInput = {};
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined)
      data.price = new D(dto.price).toFixed(2);
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.outOfStock !== undefined) data.outOfStock = dto.outOfStock;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.stockQuantity !== undefined) data.stockQuantity = dto.stockQuantity;
    if (dto.lowStockThreshold !== undefined)
      data.lowStockThreshold = dto.lowStockThreshold;
    return data;
  }

  private serializeProduct(
    p: Prisma.ProductGetPayload<{ include: { category: true } }>,
  ) {
    return {
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      description: p.description,
      price: money(p.price),
      imageUrl: p.imageUrl,
      outOfStock: p.outOfStock,
      stockQuantity: p.stockQuantity,
      lowStockThreshold: p.lowStockThreshold,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      category: p.category,
    };
  }

  private salesWindow(period: 'today' | 'week' | 'month') {
    const now = new Date();
    const end = now;
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') {
      start = new Date(start);
      start.setDate(start.getDate() - 6);
    }
    if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return { start, end };
  }

  async topSellingProducts(q: TopSellingProductsQueryDto) {
    const limit = Math.min(20, Math.max(1, q.limit ?? 5));
    const period = q.period ?? 'month';
    const { start, end } = this.salesWindow(period);

    const orderWhere = {
      status: OrderStatus.COMPLETED,
      createdAt: { gte: start, lte: end },
    };

    const [byProductId, bySnapshotName] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: {
          productId: { not: null },
          order: orderWhere,
        },
        _sum: { quantity: true, lineTotal: true },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productName'],
        where: {
          productId: null,
          order: orderWhere,
        },
        _sum: { quantity: true, lineTotal: true },
      }),
    ]);

    const ids = byProductId.map((g) => g.productId).filter(Boolean) as string[];
    const products = ids.length
      ? await this.prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, imageUrl: true },
        })
      : [];
    const byId = new Map(products.map((pr) => [pr.id, pr]));

    type Row = {
      productId: string | null;
      name: string;
      imageUrl: string | null;
      unitsSold: number;
      revenue: number;
    };

    const merged: Row[] = [];

    for (const g of byProductId) {
      if (!g.productId) continue;
      const pr = byId.get(g.productId);
      merged.push({
        productId: g.productId,
        name: pr?.name ?? '(Removed)',
        imageUrl: pr?.imageUrl ?? null,
        unitsSold: g._sum.quantity ?? 0,
        revenue: money(g._sum.lineTotal ?? 0),
      });
    }

    for (const g of bySnapshotName) {
      merged.push({
        productId: null,
        name: g.productName,
        imageUrl: null,
        unitsSold: g._sum.quantity ?? 0,
        revenue: money(g._sum.lineTotal ?? 0),
      });
    }

    merged.sort((a, b) => b.revenue - a.revenue);
    const top = merged.slice(0, limit).map((row, idx) => ({
      rank: idx + 1,
      ...row,
    }));

    return {
      period,
      from: start.toISOString(),
      to: end.toISOString(),
      limit,
      items: top,
    };
  }

  async stockAlerts(q: StockAlertsQueryDto) {
    const limit = Math.min(50, Math.max(1, q.limit ?? 20));

    const active = await this.prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        stockQuantity: true,
        lowStockThreshold: true,
        outOfStock: true,
      },
      orderBy: [{ stockQuantity: 'asc' }],
    });

    type Severity = 'OUT_OF_STOCK' | 'LOW_STOCK';
    type AlertRow = {
      productId: string;
      name: string;
      imageUrl: string | null;
      stockQuantity: number;
      lowStockThreshold: number;
      severity: Severity;
      label: string;
    };

    const alerts: AlertRow[] = [];

    for (const p of active) {
      const critical = p.outOfStock || p.stockQuantity <= 0;
      const low =
        !critical &&
        p.stockQuantity > 0 &&
        p.stockQuantity <= p.lowStockThreshold;

      if (critical) {
        alerts.push({
          productId: p.id,
          name: p.name,
          imageUrl: p.imageUrl,
          stockQuantity: p.stockQuantity,
          lowStockThreshold: p.lowStockThreshold,
          severity: 'OUT_OF_STOCK',
          label: p.stockQuantity <= 0 ? 'OUT OF STOCK' : 'UNAVAILABLE',
        });
      } else if (low) {
        alerts.push({
          productId: p.id,
          name: p.name,
          imageUrl: p.imageUrl,
          stockQuantity: p.stockQuantity,
          lowStockThreshold: p.lowStockThreshold,
          severity: 'LOW_STOCK',
          label: `${p.stockQuantity} LEFT`,
        });
      }
    }

    alerts.sort((a, b) => {
      if (a.severity !== b.severity)
        return a.severity === 'OUT_OF_STOCK' ? -1 : 1;
      return a.stockQuantity - b.stockQuantity;
    });

    const sliced = alerts.slice(0, limit);
    return {
      requestedLimit: limit,
      returned: sliced.length,
      items: sliced,
    };
  }
}
