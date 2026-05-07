import { Global, Module } from '@nestjs/common';
import { SessionInvalidationService } from '../services/session-invalidation.service';

@Global()
@Module({
  providers: [SessionInvalidationService],
  exports: [SessionInvalidationService],
})
export class SessionInvalidationModule {}
