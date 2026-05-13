import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalFilesService } from '../../common/upload/local-files.service';
import {
  BulkCategoriesDto,
  BulkDeleteCategoriesDto,
  BulkDeleteProductsDto,
  BulkProductsDto,
  CreateCategoryDto,
  CreateProductDto,
  ListCategoriesQueryDto,
  ListProductsQueryDto,
  ProductStockFilter,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto/catalog.dto';
import type {
  StockAlertsQueryDto,
  TopSellingProductsQueryDto,
} from './dto/dashboard.dto';
import type { Express } from 'express';
import D from 'decimal.js';

function money(v: unknown): number {
  return Number(v);
}

function skuCsvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localFiles: LocalFilesService,
  ) {}

  private slugifyName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72);
  }

  private async generateUniqueCategorySlug(name: string): Promise<string> {
    let base = this.slugifyName(name);
    if (!base.length) base = 'category';
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? base : `${base}-${i}`;
      const exists = await this.prisma.productCategory.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new ConflictException('Could not allocate a unique category slug.');
  }

  // --- Categories ---

  async listCategories(q?: ListCategoriesQueryDto) {
    const where: Prisma.ProductCategoryWhereInput = {
      ...(q?.activeOnly ? { isActive: true } : {}),
    };

    const rows = await this.prisma.productCategory.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { products: true } },
      },
    });

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      imageUrl: this.localFiles.toAbsoluteAssetUrl(c.imageUrl),
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      productCount: c._count.products,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  async createCategory(dto: CreateCategoryDto) {
    const slug =
      dto.slug?.trim().toLowerCase() ??
      (await this.generateUniqueCategorySlug(dto.name));
    try {
      const cat = await this.prisma.productCategory.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return {
        ...cat,
        imageUrl: this.localFiles.toAbsoluteAssetUrl(cat.imageUrl),
      };
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
      const cat = await this.prisma.productCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug.toLowerCase() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      return {
        ...cat,
        imageUrl: this.localFiles.toAbsoluteAssetUrl(cat.imageUrl),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Category slug already exists.');
      }
      throw e;
    }
  }

  async removeCategory(id: string) {
    const cat = await this.prisma.productCategory.findUnique({
      where: { id },
      select: { id: true, name: true, imageUrl: true },
    });
    if (!cat) throw new NotFoundException('Category not found');

    const inUse = await this.prisma.product.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw new ConflictException(
        `Cannot delete category '${cat.name}' because it contains ${inUse} product(s). Move or delete those products first.`,
      );
    }
    this.localFiles.removeManagedFile(cat.imageUrl);
    await this.prisma.productCategory.delete({ where: { id } });
    return { ok: true };
  }

  async bulkCategories(dto: BulkCategoriesDto) {
    if (dto.isActive === undefined) {
      throw new ConflictException('Provide isActive.');
    }

    await this.prisma.productCategory.updateMany({
      where: { id: { in: dto.ids } },
      data: { isActive: dto.isActive },
    });
    return { ok: true, updated: dto.ids.length };
  }

  async bulkDeleteCategories(dto: BulkDeleteCategoriesDto) {
    const removed: string[] = [];
    const errors: { id: string; message: string }[] = [];
    for (const id of dto.ids) {
      try {
        await this.removeCategory(id);
        removed.push(id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ id, message });
      }
    }
    return { ok: errors.length === 0, removed, errors };
  }

  private async requireCategory(id: string) {
    const c = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Category not found');
    return c;
  }

  // --- Products ---

  private async stockStatusFilterIds(
    stockStatus: ProductStockFilter,
  ): Promise<string[]> {
    if (stockStatus === ProductStockFilter.OUT_OF_STOCK) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT id FROM products
          WHERE out_of_stock = true OR stock_quantity <= 0
        `,
      );
      return rows.map((r) => r.id);
    }
    if (stockStatus === ProductStockFilter.LOW_STOCK) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT id FROM products
          WHERE out_of_stock = false
            AND stock_quantity > 0
            AND stock_quantity <= low_stock_threshold
        `,
      );
      return rows.map((r) => r.id);
    }
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        SELECT id FROM products
        WHERE out_of_stock = false
          AND stock_quantity > low_stock_threshold
      `,
    );
    return rows.map((r) => r.id);
  }

  async listProducts(q: ListProductsQueryDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 50));
    const skip = (page - 1) * limit;

    let stockIds: string[] | undefined;
    if (q.stockStatus) {
      stockIds = await this.stockStatusFilterIds(q.stockStatus);
    }

    const where: Prisma.ProductWhereInput = {
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.onlyActive ? { isActive: true } : {}),
      ...(q.publishedOnly ? { isDraft: false } : {}),
      ...(q.priceMin !== undefined || q.priceMax !== undefined
        ? {
            price: {
              ...(q.priceMin !== undefined ? { gte: q.priceMin } : {}),
              ...(q.priceMax !== undefined ? { lte: q.priceMax } : {}),
            },
          }
        : {}),
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
              { sku: { contains: q.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(stockIds !== undefined ? { id: { in: stockIds } } : {}),
    };

    const sortBy = q.sortBy ?? 'name';
    const sortDir = q.sortDir ?? 'asc';
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sortBy === 'name'
        ? { name: sortDir }
        : sortBy === 'price'
          ? { price: sortDir }
          : sortBy === 'stockQuantity'
            ? { stockQuantity: sortDir }
            : { updatedAt: sortDir };

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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

  async exportProductsCsv(q: ListProductsQueryDto): Promise<{
    filename: string;
    csv: string;
  }> {
    const probe = await this.listProducts({ ...q, page: 1, limit: 1 });
    const take = Math.min(10_000, Math.max(probe.total, 1));
    const { data } = await this.listProducts({
      ...q,
      page: 1,
      limit: take,
    });

    const headers = [
      'id',
      'sku',
      'name',
      'category',
      'price',
      'costPrice',
      'stockQty',
      'stockStatus',
      'isActive',
      'isDraft',
      'updatedAt',
    ];

    const lines = [
      headers.join(','),
      ...data.map((row) =>
        [
          row.id,
          row.sku ?? '',
          skuCsvEscape(row.name),
          skuCsvEscape(row.category?.name ?? ''),
          row.price,
          row.costPrice,
          row.stockQuantity,
          row.stockStatus,
          row.isActive,
          row.isDraft,
          row.updatedAt.toISOString(),
        ].join(','),
      ),
    ];

    return {
      filename: `products-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join('\n'),
    };
  }

  async bulkProducts(dto: BulkProductsDto) {
    const data: Prisma.ProductUpdateManyMutationInput = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isDraft !== undefined) data.isDraft = dto.isDraft;

    if (Object.keys(data).length === 0) {
      throw new ConflictException('Provide isActive and/or isDraft.');
    }

    const res = await this.prisma.product.updateMany({
      where: { id: { in: dto.ids } },
      data,
    });
    return { ok: true, updated: res.count };
  }

  async bulkDeleteProducts(dto: BulkDeleteProductsDto) {
    const res = await this.prisma.product.deleteMany({
      where: { id: { in: dto.ids } },
    });
    return { ok: true, deleted: res.count };
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
        sku: dto.sku?.trim() || null,
        name: dto.name,
        description: dto.description ?? null,
        price: new D(dto.price).toFixed(2),
        costPrice:
          dto.costPrice !== undefined
            ? new D(dto.costPrice).toFixed(2)
            : new D(0).toFixed(2),
        imageUrl: dto.imageUrl ?? null,
        outOfStock: dto.outOfStock ?? false,
        isDraft: dto.isDraft ?? false,
        isActive: dto.isActive ?? true,
        stockQuantity: dto.stockQuantity ?? 500,
        lowStockThreshold: dto.lowStockThreshold ?? 10,
        autoRefillAlerts: dto.autoRefillAlerts ?? true,
        variants: dto.variants?.length
          ? (dto.variants as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        addons: dto.addons?.length
          ? (dto.addons as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
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

  async updateProductImage(id: string, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException(
        'Image file is required (multipart field name: file).',
      );
    }
    await this.requireProduct(id);
    const prev = await this.prisma.product.findUnique({
      where: { id },
      select: { imageUrl: true },
    });
    this.localFiles.removeManagedFile(prev?.imageUrl);
    const publicPath = this.localFiles.publicPath('products', file.filename);
    const p = await this.prisma.product.update({
      where: { id },
      data: { imageUrl: publicPath },
      include: { category: true },
    });
    return this.serializeProduct(p);
  }

  async updateCategoryImage(id: string, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException(
        'Image file is required (multipart field name: file).',
      );
    }
    await this.requireCategory(id);
    const prev = await this.prisma.productCategory.findUnique({
      where: { id },
      select: { imageUrl: true },
    });
    this.localFiles.removeManagedFile(prev?.imageUrl);
    const publicPath = this.localFiles.publicPath('categories', file.filename);
    await this.prisma.productCategory.update({
      where: { id },
      data: { imageUrl: publicPath },
    });
    const rows = await this.listCategories();
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundException('Category not found');
    return row;
  }

  async removeProduct(id: string) {
    const p = await this.requireProduct(id);
    this.localFiles.removeManagedFile(p.imageUrl);
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
    if (dto.sku !== undefined) data.sku = dto.sku?.trim() ?? null;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined)
      data.price = new D(dto.price).toFixed(2);
    if (dto.costPrice !== undefined)
      data.costPrice = new D(dto.costPrice).toFixed(2);
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.outOfStock !== undefined) data.outOfStock = dto.outOfStock;
    if (dto.isDraft !== undefined) data.isDraft = dto.isDraft;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.stockQuantity !== undefined) data.stockQuantity = dto.stockQuantity;
    if (dto.lowStockThreshold !== undefined)
      data.lowStockThreshold = dto.lowStockThreshold;
    if (dto.autoRefillAlerts !== undefined)
      data.autoRefillAlerts = dto.autoRefillAlerts;
    if (dto.variants !== undefined) {
      data.variants =
        dto.variants === null
          ? Prisma.DbNull
          : (dto.variants as unknown as Prisma.InputJsonValue);
    }
    if (dto.addons !== undefined) {
      data.addons =
        dto.addons === null
          ? Prisma.DbNull
          : (dto.addons as unknown as Prisma.InputJsonValue);
    }
    return data;
  }

  private computeStockStatus(p: {
    outOfStock: boolean;
    stockQuantity: number;
    lowStockThreshold: number;
  }): 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK' {
    if (p.outOfStock || p.stockQuantity <= 0) return 'OUT_OF_STOCK';
    if (p.stockQuantity <= p.lowStockThreshold) return 'LOW_STOCK';
    return 'IN_STOCK';
  }

  private serializeProduct(
    p: Prisma.ProductGetPayload<{ include: { category: true } }>,
  ) {
    const variants =
      p.variants === null || p.variants === undefined
        ? null
        : (p.variants as unknown);
    const addons =
      p.addons === null || p.addons === undefined
        ? null
        : (p.addons as unknown);

    return {
      id: p.id,
      categoryId: p.categoryId,
      sku: p.sku,
      name: p.name,
      description: p.description,
      price: money(p.price),
      costPrice: money(p.costPrice),
      imageUrl: this.localFiles.toAbsoluteAssetUrl(p.imageUrl),
      outOfStock: p.outOfStock,
      stockQuantity: p.stockQuantity,
      lowStockThreshold: p.lowStockThreshold,
      autoRefillAlerts: p.autoRefillAlerts,
      isDraft: p.isDraft,
      isActive: p.isActive,
      stockStatus: this.computeStockStatus(p),
      variants,
      addons,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      category: {
        ...p.category,
        imageUrl: this.localFiles.toAbsoluteAssetUrl(p.category.imageUrl),
      },
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
        imageUrl: this.localFiles.toAbsoluteAssetUrl(pr?.imageUrl ?? null),
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

    const store = await this.prisma.storeSettings.findUnique({
      where: { id: 'default' },
      select: { lowStockAlertsEnabled: true },
    });
    if (store && !store.lowStockAlertsEnabled) {
      return { requestedLimit: limit, returned: 0, items: [] };
    }

    const active = await this.prisma.product.findMany({
      where: { isActive: true, isDraft: false },
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
          imageUrl: this.localFiles.toAbsoluteAssetUrl(p.imageUrl),
          stockQuantity: p.stockQuantity,
          lowStockThreshold: p.lowStockThreshold,
          severity: 'OUT_OF_STOCK',
          label: p.stockQuantity <= 0 ? 'OUT OF STOCK' : 'UNAVAILABLE',
        });
      } else if (low) {
        alerts.push({
          productId: p.id,
          name: p.name,
          imageUrl: this.localFiles.toAbsoluteAssetUrl(p.imageUrl),
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
