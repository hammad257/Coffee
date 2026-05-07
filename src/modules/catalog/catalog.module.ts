import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { ProductsController } from './products.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CategoriesController, ProductsController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
