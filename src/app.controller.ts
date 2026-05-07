import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { Permissions } from './common/decorators/permissions.decorator';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Public ping' })
  getHello(): string {
    return this.appService.getHello();
  }

  /** Example RBAC-protected route — requires `dashboard.read` permission. */
  @ApiBearerAuth('access-token')
  @Get('dashboard/ping')
  @Permissions('dashboard.read')
  @ApiOperation({ summary: 'RBAC demo (manager seed has this permission)' })
  getDashboardPing(): { ok: boolean } {
    return { ok: true };
  }
}
