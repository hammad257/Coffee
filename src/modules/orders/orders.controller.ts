import {
  Body,
  Controller,
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
      'Dashboard: recent orders (by last update) with headline line item and counts',
  })
  recentDashboard(@Query() q: RecentOrdersQueryDto) {
    return this.orders.recentDashboardOrders(q);
  }

  @Get()
  @Permissions('coffee.order.read')
  @ApiOperation({ summary: 'List orders with filters' })
  list(@Query() q: ListOrdersQueryDto) {
    return this.orders.list(q);
  }

  @Post()
  @Permissions('coffee.order.create')
  @ApiOperation({ summary: 'Create order (POS checkout / manual)' })
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
  @ApiOperation({ summary: 'Workflow transition (NEW → PREPARING → READY → …)' })
  patchStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchOrderStatusDto,
  ) {
    return this.orders.patchStatus(id, dto);
  }
}
