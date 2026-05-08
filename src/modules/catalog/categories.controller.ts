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
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/catalog.dto';

@ApiTags('POS — Catalog')
@ApiBearerAuth('access-token')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Permissions('coffee.category.read')
  @ApiOperation({ summary: 'List product categories' })
  list() {
    return this.catalog.listCategories();
  }

  @Post()
  @Permissions('coffee.category.create')
  @ApiOperation({ summary: 'Create category' })
  create(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch(':id')
  @Permissions('coffee.category.update')
  @ApiOperation({ summary: 'Update category' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(id, dto);
  }

  @Delete(':id')
  @Permissions('coffee.category.delete')
  @ApiOperation({ summary: 'Delete empty category' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeCategory(id);
  }
}
