import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types';
import {
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';

@ApiTags('Identity — Roles')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions('identity.role.read')
  @ApiOperation({ summary: 'List roles with counts' })
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.roles.findAll(page, limit);
  }

  @Post()
  @Permissions('identity.role.create')
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Get(':id')
  @Permissions('identity.role.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.findOne(id);
  }

  @Patch(':id')
  @Permissions('identity.role.update')
  patch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @Permissions('identity.role.delete')
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(id);
  }

  @Put(':id/permissions')
  @Permissions('identity.role.update')
  setPermissions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.roles.setPermissions(actor.id, id, dto);
  }
}
