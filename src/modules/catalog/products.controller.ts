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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CatalogService } from './catalog.service';
import {
  BulkDeleteProductsDto,
  BulkProductsDto,
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/catalog.dto';
import {
  StockAlertsQueryDto,
  TopSellingProductsQueryDto,
} from './dto/dashboard.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { multerImageOptions } from '../../common/upload/multer-image.config';

@ApiTags('POS — Catalog')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('export')
  @Permissions('coffee.product.read')
  @ApiOperation({
    summary:
      'CSV export (same filters as list — returns filename + csv in wrapped JSON body)',
  })
  exportCsv(@Query() q: ListProductsQueryDto) {
    return this.catalog.exportProductsCsv(q);
  }

  /** Register before :id */
  @Get('stats/top-selling')
  @Permissions('coffee.stats.read')
  @ApiOperation({
    summary:
      'Dashboard: top products by revenue (completed orders) for today / week / month',
  })
  topSelling(@Query() q: TopSellingProductsQueryDto) {
    return this.catalog.topSellingProducts(q);
  }

  /** Register before :id */
  @Get('stats/stock-alerts')
  @Permissions('coffee.stats.read')
  @ApiOperation({
    summary: 'Dashboard: products that are out of stock or below low-stock threshold',
  })
  stockAlerts(@Query() q: StockAlertsQueryDto) {
    return this.catalog.stockAlerts(q);
  }

  @Patch('bulk')
  @Permissions('coffee.product.update')
  @ApiOperation({ summary: 'Bulk activate/deactivate or draft flag' })
  bulk(@Body() dto: BulkProductsDto) {
    return this.catalog.bulkProducts(dto);
  }

  @Post('bulk-delete')
  @Permissions('coffee.product.delete')
  @ApiOperation({ summary: 'Bulk delete products by id' })
  bulkDelete(@Body() dto: BulkDeleteProductsDto) {
    return this.catalog.bulkDeleteProducts(dto);
  }

  @Get()
  @Permissions('coffee.product.read')
  @ApiOperation({
    summary:
      'List products — filters: stockStatus, price range, SKU/name search, sort, publishedOnly for POS',
  })
  list(@Query() q: ListProductsQueryDto) {
    return this.catalog.listProducts(q);
  }

  @Post()
  @Permissions('coffee.product.create')
  @ApiOperation({
    summary:
      'Create product — SKU, cost, variants/add-ons JSON, isDraft for Save draft, publish with isDraft:false',
  })
  create(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
  }

  @Get(':id')
  @Permissions('coffee.product.read')
  @ApiOperation({ summary: 'Product detail' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getProduct(id);
  }

  @Patch(':id/image')
  @Permissions('coffee.product.update')
  @UseInterceptors(FileInterceptor('file', multerImageOptions('products')))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Upload product image — API returns absolute imageUrl (PUBLIC_BASE_URL + /uploads/products/…)',
  })
  uploadProductImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.catalog.updateProductImage(id, file);
  }

  @Patch(':id')
  @Permissions('coffee.product.update')
  @ApiOperation({ summary: 'Update product' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(id, dto);
  }

  @Delete(':id')
  @Permissions('coffee.product.delete')
  @ApiOperation({ summary: 'Delete product' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeProduct(id);
  }
}
