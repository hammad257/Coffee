import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types';
import {
  CreateOrderDto,
  ListOrdersQueryDto,
  PatchOrderStatusDto,
  UpdateOrderDto,
} from './dto/order.dto';
import { RecentOrdersQueryDto } from './dto/dashboard.dto';
import { OrdersService } from './orders.service';

@ApiTags('POS — Orders')
@ApiBearerAuth('access-token')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Register before :id */
  @Get('stats/summary')
  @Permissions('coffee.stats.read')
  @ApiOperation({
    summary:
      'Manager dashboard KPIs: revenue & orders today, month, active pipeline, tables, hourly chart, vs-yesterday trend',
  })
  statsSummary() {
    return this.orders.statsSummary();
  }

  /** Register before :id */
  @Get('dashboard/recent')
  @Permissions('coffee.stats.read')
  @ApiOperation({
    summary:
      'Dashboard: recent orders by last update — filter by lane (type/fulfillment) or pipeline-only (activeOnly)',
  })
  recentDashboard(@Query() q: RecentOrdersQueryDto) {
    return this.orders.recentDashboardOrders(q);
  }

  @Get()
  @Permissions('coffee.order.read')
  @ApiOperation({
    summary:
      'List orders — supports status/type, payment filters, search, date range or preset (today/week/month), sortBy updatedAt',
  })
  list(@Query() q: ListOrdersQueryDto) {
    return this.orders.list(q);
  }

  @Post()
  @Permissions('coffee.order.create')
  @ApiOperation({
    summary:
      'Create order — set status HELD/DRAFT for hold/clear flow, assignedToId + tableId for dashboards',
  })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(actor.id, dto);
  }

  @Get(':id')
  @Permissions('coffee.order.read')
  @ApiOperation({ summary: 'Order detail with line items' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(id);
  }

  @Patch(':id')
  @Permissions('coffee.order.update')
  @ApiOperation({ summary: 'Update order header, customer, payment, or replace line items' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(actor.id, id, dto);
  }

  @Patch(':id/status')
  @Permissions('coffee.order.update_status')
  @ApiOperation({
    summary:
      'Workflow — includes SERVED (dine-in served at table); Pay Now sends COMPLETED (+ optional amountTendered for cash tender/change)',
  })
  patchStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchOrderStatusDto,
  ) {
    return this.orders.patchStatus(id, dto);
  }

  @Delete(':id')
  @Permissions('coffee.order.delete')
  @ApiOperation({
    summary:
      'Delete DRAFT or HELD order only ("Clear") — frees linked dine-in table',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.remove(id);
  }
}
