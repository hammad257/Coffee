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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CatalogService } from './catalog.service';
import {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/catalog.dto';

@ApiTags('POS — Catalog')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Permissions('coffee.product.read')
  @ApiOperation({ summary: 'List products (paginated)' })
  list(@Query() q: ListProductsQueryDto) {
    return this.catalog.listProducts(q);
  }

  @Get(':id')
  @Permissions('coffee.product.read')
  @ApiOperation({ summary: 'Product detail' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getProduct(id);
  }

  @Post()
  @Permissions('coffee.product.create')
  @ApiOperation({ summary: 'Create product' })
  create(@Body() dto: CreateProductDto) {
    return this.catalog.createProduct(dto);
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
