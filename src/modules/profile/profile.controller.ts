import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types';
import { ListMyActivityQueryDto, PatchMyProfileDto } from './dto/profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('Identity — Profile')
@ApiBearerAuth('access-token')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Current user POS profile — matches Profile screen payload' })
  me(@CurrentUser() actor: AuthUser) {
    return this.profile.getMyProfile(actor.id);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Update own profile — email/first/last bump tokenVersion and require re-login',
  })
  patchMe(@CurrentUser() actor: AuthUser, @Body() dto: PatchMyProfileDto) {
    return this.profile.patchMyProfile(actor.id, dto);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Recent activity timeline for current user' })
  activity(
    @CurrentUser() actor: AuthUser,
    @Query() q: ListMyActivityQueryDto,
  ) {
    return this.profile.listMyActivity(actor.id, q);
  }
}
