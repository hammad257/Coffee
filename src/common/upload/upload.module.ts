import { Global, Module } from '@nestjs/common';
import { LocalFilesService } from './local-files.service';

@Global()
@Module({
  providers: [LocalFilesService],
  exports: [LocalFilesService],
})
export class UploadModule {}
