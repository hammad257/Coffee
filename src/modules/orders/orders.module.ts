import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TablesController } from './tables.controller';

@Module({
  controllers: [OrdersController, TablesController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
