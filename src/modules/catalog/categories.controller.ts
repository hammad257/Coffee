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
  BulkCategoriesDto,
  BulkDeleteCategoriesDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/catalog.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { multerImageOptions } from '../../common/upload/multer-image.config';

@ApiTags('POS — Catalog')
@ApiBearerAuth('access-token')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Permissions('coffee.category.read')
  @ApiOperation({
    summary:
      'List categories with product counts — use activeOnly for dropdowns',
  })
  list(@Query() q: ListCategoriesQueryDto) {
    return this.catalog.listCategories(q);
  }

  @Patch('bulk')
  @Permissions('coffee.category.update')
  @ApiOperation({ summary: 'Bulk activate/deactivate categories' })
  bulk(@Body() dto: BulkCategoriesDto) {
    return this.catalog.bulkCategories(dto);
  }

  @Post('bulk-delete')
  @Permissions('coffee.category.delete')
  @ApiOperation({
    summary:
      'Delete multiple categories (each must be empty — same rules as DELETE :id)',
  })
  bulkDelete(@Body() dto: BulkDeleteCategoriesDto) {
    return this.catalog.bulkDeleteCategories(dto);
  }

  @Post()
  @Permissions('coffee.category.create')
  @ApiOperation({ summary: 'Create category (slug optional — auto from name)' })
  create(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Patch(':id/image')
  @Permissions('coffee.category.update')
  @UseInterceptors(FileInterceptor('file', multerImageOptions('categories')))
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
      'Upload category image — API returns absolute imageUrl (PUBLIC_BASE_URL + /uploads/categories/…)',
  })
  uploadCategoryImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.catalog.updateCategoryImage(id, file);
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
  @ApiOperation({
    summary:
      'Delete category only when it has no products (aligned with admin UI guard)',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeCategory(id);
  }
}
