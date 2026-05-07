import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';

@ApiTags('Identity — Permissions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  /** Static path — register before `@Get()` for clarity. */
  @Get('grouped')
  @Permissions('identity.permission.read')
  @ApiOperation({ summary: 'Grouped by module for matrix UI' })
  grouped() {
    return this.permissions.grouped();
  }

  @Get()
  @Permissions('identity.permission.read')
  @ApiOperation({ summary: 'Flat permission catalog (read-only)' })
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    return this.permissions.findAll(page, limit);
  }
}
