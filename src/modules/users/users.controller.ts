import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  ForbiddenException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../common/types';
import {
  AssignUserRolesDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserPasswordDto,
} from './dto/user.dto';
import { UsersService } from './users.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { multerImageOptions } from '../../common/upload/multer-image.config';

@ApiTags('Identity — Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions('identity.user.read')
  @ApiOperation({ summary: 'List users (paginated)' })
  list(@Query() q: ListUsersQueryDto) {
    return this.users.listActors(q);
  }

  @Post()
  @Permissions('identity.user.create')
  @ApiOperation({ summary: 'Create user (default status PENDING unless set)' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor.id, dto);
  }

  @Get(':id/permissions')
  @Permissions('identity.user.read')
  effective(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.effectivePermissions(id);
  }

  @Put(':id/roles')
  @Permissions('identity.user.update')
  assignRoles(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignUserRolesDto,
  ) {
    return this.users.assignRoles(actor.id, id, dto);
  }

  // @Put(':id/scope')
  // @Permissions('identity.user.update')
  // assignScope(
  //   @CurrentUser() actor: AuthUser,
  //   @Param('id', ParseUUIDPipe) id: string,
  //   @Body() dto: UpdateUserScopeDto,
  // ) {
  //   return this.users.updateScope(actor.id, id, dto);
  // }

  @Patch(':id/password')
  @ApiOperation({ summary: 'Change password — self requires currentPassword' })
  patchPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserPasswordDto,
  ) {
    if (
      actor.id !== id &&
      !actor.permissions.includes('identity.user.update')
    ) {
      throw new ForbiddenException('Not allowed to change this password.');
    }
    return this.users.updatePassword(actor, id, dto);
  }

  @Patch(':id/photo')
  @UseInterceptors(FileInterceptor('file', multerImageOptions('users')))
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
      'Upload profile picture — DB stores /uploads/users/…; API returns full URL using PUBLIC_BASE_URL',
  })
  uploadPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (
      actor.id !== id &&
      !actor.permissions?.includes('identity.user.update')
    ) {
      throw new ForbiddenException(
        'You can only change your own photo unless you may update users.',
      );
    }
    return this.users.updateProfilePhoto(id, file, actor.id);
  }

  @Get(':id')
  @Permissions('identity.user.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @Permissions('identity.user.update')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(actor.id, id, dto);
  }

  @Delete(':id')
  @Permissions('identity.user.delete')
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.remove(actor.id, id);
  }
}
