import {
  Body,
  Controller,
  Get,
  Patch,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types';
import { multerImageOptions } from '../../common/upload/multer-image.config';
import { PatchStoreSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('POS — Store settings')
@ApiBearerAuth('access-token')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Permissions('coffee.settings.read')
  @ApiOperation({
    summary:
      'Store info, tax, payment toggles, system flags — aligns with Settings screen',
  })
  getStore() {
    return this.settings.getStore();
  }

  @Patch()
  @Permissions('coffee.settings.update')
  @ApiOperation({ summary: 'Partial update — writes audit activity' })
  patchStore(
    @CurrentUser() actor: AuthUser,
    @Body() dto: PatchStoreSettingsDto,
  ) {
    return this.settings.patchStore(actor.id, dto);
  }

  @Patch('logo')
  @Permissions('coffee.settings.update')
  @UseInterceptors(FileInterceptor('file', multerImageOptions('store')))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload store logo → uploads/store' })
  uploadLogo(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.settings.setStoreLogo(actor.id, file);
  }
}
