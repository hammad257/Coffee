import { Module } from '@nestjs/common';
import { DiscoveryModule, MetadataScanner } from '@nestjs/core';
import { PermissionScannerService } from './permissions-scanner.service';

@Module({
  imports: [DiscoveryModule],
  providers: [PermissionScannerService, MetadataScanner],
  exports: [PermissionScannerService],
})
export class RbacModule {}
