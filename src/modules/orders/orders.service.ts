import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FulfillmentMethod,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TableStatus,
} from '@prisma/client';
import DecimalPkg from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOrderDto,
  CreateTableDto,
  ListOrdersQueryDto,
  PatchOrderStatusDto,
  UpdateOrderDto,
  UpdateTableDto,
} from './dto/order.dto';
import { RecentOrdersQueryDto } from './dto/dashboard.dto';
import { randomUUID } from 'crypto';

type Dec = InstanceType<typeof DecimalPkg>;

const d = (x: unknown) => Number(x);

const roundMoney = (v: Dec) => v.toDecimalPlaces(2);

@Injectable()
export class OrdersService {
  private readonly defaultTaxRate: Dec;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const raw = config.get<string>('DEFAULT_TAX_RATE');
    this.defaultTaxRate = new DecimalPkg(raw ?? '0.08');
  }

  private genOrderNumber(type: OrderType): string {
    const prefix =
      type === OrderType.DINE_IN
        ? 'D'
        : type === OrderType.TAKEAWAY
          ? 'T'
          : 'O';
    return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  private lineTotals(items: { quantity: number; unitPrice: number }[]) {
    let subtotal = new DecimalPkg(0);
    for (const row of items) {
      const line = roundMoney(
        new DecimalPkg(row.unitPrice).times(row.quantity),
      );
      subtotal = subtotal.plus(line);
    }
    return { subtotal: roundMoney(subtotal) };
  }

  private computeTaxAndTotal(subtotal: Dec, taxRate: Dec, deliveryFee: Dec) {
    const taxAmount = roundMoney(subtotal.times(taxRate));
    const total = roundMoney(subtotal.plus(taxAmount).plus(deliveryFee));
    return { taxAmount, total };
  }

  async statsSummary() {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const endOfDayExclusive = new Date(startOfDay);
    endOfDayExclusive.setDate(endOfDayExclusive.getDate() + 1);

    const startOfYesterday = new Date(startOfDay);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeStatuses: OrderStatus[] = [
      OrderStatus.DRAFT,
      OrderStatus.NEW,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.HELD,
    ];

    const [
      todaySum,
      todayCompletedCount,
      yesterdaySum,
      activeOrders,
      todayCompletedForChart,
      monthOrders,
      tableTotal,
      tablesOccupied,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfDay },
          status: OrderStatus.COMPLETED,
        },
        _sum: { total: true },
      }),
      this.prisma.order.count({
        where: {
          createdAt: { gte: startOfDay },
          status: OrderStatus.COMPLETED,
        },
      }),
      this.prisma.order.aggregate({
        where: {
          createdAt: {
            gte: startOfYesterday,
            lt: startOfDay,
          },
          status: OrderStatus.COMPLETED,
        },
        _sum: { total: true },
      }),
      this.prisma.order.count({
        where: { status: { in: activeStatuses } },
      }),
      this.prisma.order.findMany({
        where: {
          createdAt: {
            gte: startOfDay,
            lt: endOfDayExclusive,
          },
          status: OrderStatus.COMPLETED,
        },
        select: { total: true, createdAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: startOfMonth },
          status: OrderStatus.COMPLETED,
        },
        select: { total: true },
      }),
      this.prisma.dineTable.count(),
      this.prisma.dineTable.count({
        where: { status: TableStatus.OCCUPIED },
      }),
    ]);

    const todayAmountDec = todaySum._sum.total
      ? new DecimalPkg(todaySum._sum.total.toString())
      : new DecimalPkg(0);
    const todayAmountNum = d(todayAmountDec);

    const avgOrderToday =
      todayCompletedCount > 0
        ? d(roundMoney(todayAmountDec.div(todayCompletedCount)))
        : 0;

    const yesterdayAmountDec = yesterdaySum._sum.total
      ? new DecimalPkg(yesterdaySum._sum.total.toString())
      : new DecimalPkg(0);

    let revenueTrendPercentVsYesterday: number | null = null;
    const yesterdayAmountNum = d(yesterdayAmountDec);
    if (yesterdayAmountNum > 0) {
      const raw = todayAmountDec
        .minus(yesterdayAmountDec)
        .div(yesterdayAmountDec)
        .times(100);
      revenueTrendPercentVsYesterday = d(roundMoney(raw));
    }

    const salesTodayByHour = Array.from({ length: 24 }, () => 0);
    for (const row of todayCompletedForChart) {
      const hr = row.createdAt.getHours();
      salesTodayByHour[hr] +=
        Number(
          roundMoney(new DecimalPkg(row.total.toString())).toFixed(2),
        );
    }

    const monthTotalRevenue = monthOrders.reduce(
      (s, o) => s.plus(new DecimalPkg(o.total.toString())),
      new DecimalPkg(0),
    );
    const monthCount = monthOrders.length;
    const avgOrderValueMonth =
      monthCount > 0
        ? roundMoney(monthTotalRevenue.div(monthCount))
        : new DecimalPkg(0);

    const capacityPercent =
      tableTotal > 0 ? Math.round((tablesOccupied * 100) / tableTotal) : 0;

    return {
      totalOrdersToday: {
        amount: todayAmountNum,
        orderCount: todayCompletedCount,
        completedCount: todayCompletedCount,
        avgOrderValue: avgOrderToday,
        revenueTrendPercentVsYesterday,
      },
      thisMonth: {
        orderCount: monthCount,
        avgOrderValue: d(avgOrderValueMonth),
        revenue: d(roundMoney(monthTotalRevenue)),
      },
      activeOrders,
      tablesOccupied: {
        occupied: tablesOccupied,
        total: tableTotal,
        capacityPercent,
      },
      chartSalesTodayByHour: salesTodayByHour,
    };
  }

  async recentDashboardOrders(q: RecentOrdersQueryDto) {
    const limit = Math.min(50, Math.max(1, q.limit ?? 10));
    const rows = await this.prisma.order.findMany({
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { items: true } },
        items: {
          orderBy: { id: 'asc' },
          take: 1,
          select: { productName: true, quantity: true },
        },
        seatedAtTable: { select: { id: true, label: true } },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return {
      requestedLimit: limit,
      returned: rows.length,
      data: rows.map((o) => {
        const head = o.items[0] ?? null;
        const cb = o.createdBy;
        const staffName = cb
          ? [cb.firstName, cb.lastName].filter(Boolean).join(' ').trim() ||
            cb.email
          : null;
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          type: o.type,
          total: d(o.total),
          paymentStatus: o.paymentStatus,
          updatedAt: o.updatedAt,
          tableLabel: o.seatedAtTable?.label ?? null,
          headlineItemName: head?.productName ?? null,
          headlineItemQty: head?.quantity ?? null,
          itemCount: o._count.items,
          staffName,
        };
      }),
    };
  }

  async list(q: ListOrdersQueryDto) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(100, Math.max(1, q.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.dateFrom || q.dateTo
        ? {
            createdAt: {
              ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}),
            },
          }
        : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              {
                orderNumber: {
                  contains: q.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                customerName: {
                  contains: q.search.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: true,
          seatedAtTable: true,
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      data: rows.map((o) => this.serializeOrder(o)),
    };
  }

  async findOne(id: string) {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
        seatedAtTable: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    return this.serializeOrder(o);
  }

  async create(actorId: string, dto: CreateOrderDto) {
    if (dto.type === OrderType.DINE_IN && dto.tableId) {
      await this.assertTableAvailableForSeat(dto.tableId);
    } else if (dto.tableId && dto.type !== OrderType.DINE_IN) {
      throw new ConflictException('tableId is only used for dine-in orders.');
    }

    const taxRate =
      dto.taxRate !== undefined
        ? new DecimalPkg(dto.taxRate)
        : this.defaultTaxRate;
    const deliveryFee = new DecimalPkg(dto.deliveryFee ?? 0);

    const lineInputs = dto.items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }));
    const { subtotal } = this.lineTotals(lineInputs);
    const { taxAmount, total } = this.computeTaxAndTotal(
      subtotal,
      taxRate,
      deliveryFee,
    );

    const status = dto.status ?? OrderStatus.NEW;

    const order = await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          orderNumber: this.genOrderNumber(dto.type),
          status,
          type: dto.type,
          fulfillment: dto.fulfillment ?? null,
          tableId: dto.type === OrderType.DINE_IN ? (dto.tableId ?? null) : null,
          customerName: dto.customerName ?? null,
          customerPhone: dto.customerPhone ?? null,
          customerAddress: dto.customerAddress ?? null,
          baristaNote: dto.baristaNote ?? null,
          taxRate: taxRate.toFixed(4),
          subtotal: subtotal.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          deliveryFee: deliveryFee.toFixed(2),
          total: total.toFixed(2),
          paymentMethod: dto.paymentMethod ?? null,
          paymentLast4: dto.paymentLast4 ?? null,
          paymentStatus: dto.paymentStatus ?? PaymentStatus.PENDING,
          createdById: actorId,
        },
      });

      for (let idx = 0; idx < dto.items.length; idx++) {
        const row = dto.items[idx];
        const lineTotal = roundMoney(
          new DecimalPkg(row.unitPrice).times(row.quantity),
        );
        await tx.orderItem.create({
          data: {
            orderId: o.id,
            productId: row.productId ?? null,
            productName: row.productName,
            quantity: row.quantity,
            unitPrice: new DecimalPkg(row.unitPrice).toFixed(2),
            lineTotal: lineTotal.toFixed(2),
            modifiersNote: row.modifiersNote ?? null,
          },
        });
      }

      if (dto.type === OrderType.DINE_IN && dto.tableId) {
        await tx.dineTable.update({
          where: { id: dto.tableId },
          data: {
            status: TableStatus.OCCUPIED,
            activeOrderId: o.id,
          },
        });
      }

      return o;
    });

    return this.findOne(order.id);
  }

  private async assertTableAvailableForSeat(tableId: string) {
    const t = await this.prisma.dineTable.findUnique({ where: { id: tableId } });
    if (!t) throw new NotFoundException('Table not found');
    if (t.status === TableStatus.OCCUPIED && t.activeOrderId) {
      throw new ConflictException('Table already has an active order.');
    }
  }

  async update(_actorId: string, id: string, dto: UpdateOrderDto) {
    await this.requireOrder(id);

    const existing = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    const nextTableId =
      dto.tableId !== undefined ? dto.tableId : existing.tableId;
    const type = existing.type;

    if (dto.tableId !== undefined && type !== OrderType.DINE_IN) {
      throw new ConflictException('Only dine-in orders can be assigned a table.');
    }

    if (
      dto.tableId !== undefined &&
      type === OrderType.DINE_IN &&
      dto.tableId &&
      dto.tableId !== existing.tableId
    ) {
      await this.assertTableAvailableForSeat(dto.tableId);
    }

    const taxRateD = new DecimalPkg(existing.taxRate.toString());
    let subtotal = new DecimalPkg(existing.subtotal.toString());
    let taxAmount = new DecimalPkg(existing.taxAmount.toString());
    let total = new DecimalPkg(existing.total.toString());

    const deliveryFeeDec = roundMoney(
      new DecimalPkg(
        dto.deliveryFee !== undefined
          ? dto.deliveryFee
          : existing.deliveryFee.toString(),
      ),
    );

    if (dto.items && dto.items.length > 0) {
      const lineInputs = dto.items.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      }));
      const calc = this.lineTotals(lineInputs);
      subtotal = calc.subtotal;
      const t2 = this.computeTaxAndTotal(subtotal, taxRateD, deliveryFeeDec);
      taxAmount = t2.taxAmount;
      total = t2.total;
    } else if (dto.deliveryFee !== undefined) {
      const t2 = this.computeTaxAndTotal(
        new DecimalPkg(existing.subtotal.toString()),
        taxRateD,
        deliveryFeeDec,
      );
      taxAmount = t2.taxAmount;
      total = t2.total;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          ...(dto.fulfillment !== undefined
            ? { fulfillment: dto.fulfillment }
            : {}),
          ...(dto.tableId !== undefined
            ? { tableId: dto.tableId ?? null }
            : {}),
          ...(dto.customerName !== undefined
            ? { customerName: dto.customerName }
            : {}),
          ...(dto.customerPhone !== undefined
            ? { customerPhone: dto.customerPhone }
            : {}),
          ...(dto.customerAddress !== undefined
            ? { customerAddress: dto.customerAddress }
            : {}),
          ...(dto.baristaNote !== undefined
            ? { baristaNote: dto.baristaNote }
            : {}),
          ...(dto.deliveryFee !== undefined
            ? { deliveryFee: deliveryFeeDec.toFixed(2) }
            : {}),
          ...(dto.paymentStatus !== undefined
            ? { paymentStatus: dto.paymentStatus }
            : {}),
          ...(dto.paymentMethod !== undefined
            ? { paymentMethod: dto.paymentMethod }
            : {}),
          ...(dto.paymentLast4 !== undefined
            ? { paymentLast4: dto.paymentLast4 }
            : {}),
          ...(dto.items && dto.items.length
            ? {
                subtotal: subtotal.toFixed(2),
                taxAmount: taxAmount.toFixed(2),
                total: total.toFixed(2),
              }
            : dto.deliveryFee !== undefined
              ? {
                  taxAmount: taxAmount.toFixed(2),
                  total: total.toFixed(2),
                }
              : {}),
        },
      });

      if (dto.items?.length) {
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        for (const row of dto.items) {
          const lineTotal = roundMoney(
            new DecimalPkg(row.unitPrice).times(row.quantity),
          );
          await tx.orderItem.create({
            data: {
              orderId: id,
              productId: row.productId ?? null,
              productName: row.productName,
              quantity: row.quantity,
              unitPrice: new DecimalPkg(row.unitPrice).toFixed(2),
              lineTotal: lineTotal.toFixed(2),
              modifiersNote: row.modifiersNote ?? null,
            },
          });
        }
      }

      if (type === OrderType.DINE_IN) {
        await tx.dineTable.updateMany({
          where: { activeOrderId: id },
          data: { activeOrderId: null, status: TableStatus.FREE },
        });
        if (nextTableId) {
          await tx.dineTable.update({
            where: { id: nextTableId },
            data: {
              status: TableStatus.OCCUPIED,
              activeOrderId: id,
            },
          });
        }
      }
    });

    return this.findOne(id);
  }

  async patchStatus(
    id: string,
    dto: PatchOrderStatusDto,
  ) {
    await this.requireOrder(id);

    await this.prisma.order.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.paymentStatus !== undefined
          ? { paymentStatus: dto.paymentStatus }
          : {}),
        ...(dto.paymentMethod !== undefined
          ? { paymentMethod: dto.paymentMethod }
          : {}),
        ...(dto.paymentLast4 !== undefined
          ? { paymentLast4: dto.paymentLast4 }
          : {}),
        ...(dto.status === OrderStatus.COMPLETED
          ? { completedAt: new Date() }
          : {}),
        ...(dto.status === OrderStatus.CANCELLED
          ? { cancelledAt: new Date() }
          : {}),
      },
    });

    if (
      ([OrderStatus.COMPLETED, OrderStatus.CANCELLED] as OrderStatus[]).includes(
        dto.status,
      )
    ) {
      await this.releaseTableForOrder(id);
    }

    return this.findOne(id);
  }

  private async releaseTableForOrder(orderId: string) {
    await this.prisma.dineTable.updateMany({
      where: { activeOrderId: orderId },
      data: { activeOrderId: null, status: TableStatus.FREE },
    });
  }

  private async requireOrder(id: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  // --- Tables ---

  async listTables() {
    const rows = await this.prisma.dineTable.findMany({
      orderBy: { label: 'asc' },
      include: {
        activeOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
          },
        },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      status: t.status,
        activeOrder: t.activeOrder
          ? {
              ...t.activeOrder,
              total: d(t.activeOrder.total),
            }
          : null,
    }));
  }

  async createTable(dto: CreateTableDto) {
    try {
      return await this.prisma.dineTable.create({
        data: {
          label: dto.label,
          capacity: dto.capacity ?? 4,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Table label already exists.');
      }
      throw e;
    }
  }

  async updateTable(id: string, dto: UpdateTableDto) {
    await this.requireTable(id);
    return this.prisma.dineTable.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
      },
    });
  }

  private async requireTable(id: string) {
    const t = await this.prisma.dineTable.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Table not found');
    return t;
  }

  private serializeOrder(o: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    type: OrderType;
    fulfillment: FulfillmentMethod | null;
    tableId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    customerAddress: string | null;
    baristaNote: string | null;
    taxRate: unknown;
    subtotal: unknown;
    taxAmount: unknown;
    deliveryFee: unknown;
    total: unknown;
    paymentMethod: PaymentMethod | null;
    paymentLast4: string | null;
    paymentStatus: PaymentStatus;
    completedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    createdById: string;
    items?: Array<{
      id: string;
      productId: string | null;
      productName: string;
      quantity: number;
      unitPrice: unknown;
      lineTotal: unknown;
      modifiersNote: string | null;
      product?: { id: string; name: string } | null;
    }>;
    seatedAtTable?: {
      id: string;
      label: string;
      capacity: number;
      status: TableStatus;
    } | null;
    createdBy?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
  }) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      type: o.type,
      fulfillment: o.fulfillment,
      tableId: o.tableId,
      table: o.seatedAtTable
        ? {
            id: o.seatedAtTable.id,
            label: o.seatedAtTable.label,
            capacity: o.seatedAtTable.capacity,
            status: o.seatedAtTable.status,
          }
        : null,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      customerAddress: o.customerAddress,
      baristaNote: o.baristaNote,
      taxRate: d(o.taxRate),
      subtotal: d(o.subtotal),
      taxAmount: d(o.taxAmount),
      deliveryFee: d(o.deliveryFee),
      total: d(o.total),
      paymentMethod: o.paymentMethod,
      paymentLast4: o.paymentLast4,
      paymentStatus: o.paymentStatus,
      completedAt: o.completedAt,
      cancelledAt: o.cancelledAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      createdBy: o.createdBy,
      items: (o.items ?? []).map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: d(it.unitPrice),
        lineTotal: d(it.lineTotal),
        modifiersNote: it.modifiersNote,
        product: it.product ?? undefined,
      })),
    };
  }
}
