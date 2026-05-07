import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CreateTableDto, UpdateTableDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('POS — Floor')
@ApiBearerAuth('access-token')
@Controller('tables')
export class TablesController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Permissions('coffee.table.read')
  @ApiOperation({ summary: 'Dine-in table grid (occupancy + active order)' })
  list() {
    return this.orders.listTables();
  }

  @Post()
  @Permissions('coffee.table.create')
  @ApiOperation({ summary: 'Add a table' })
  create(@Body() dto: CreateTableDto) {
    return this.orders.createTable(dto);
  }

  @Patch(':id')
  @Permissions('coffee.table.update')
  @ApiOperation({ summary: 'Update table status or capacity' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.orders.updateTable(id, dto);
  }
}
