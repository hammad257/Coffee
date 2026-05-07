import { Injectable } from '@nestjs/common';
import {
  ModulesContainer,
  Reflector,
  MetadataScanner,
} from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { MODULE_KEY } from '../decorators/permissions-module.decorator';

@Injectable()
export class PermissionScannerService {
  constructor(
    private modulesContainer: ModulesContainer,
    private reflector: Reflector,
    private metadataScanner: MetadataScanner,
  ) {}

  scanPermissions() {
    const result: Record<string, any[]> = {};

    const modules = [...this.modulesContainer.values()];

    for (const module of modules) {
      const controllers = module.controllers;

      for (const wrapper of controllers.values()) {
        const instance = wrapper.instance;
        if (!instance) continue;

        const prototype = Object.getPrototypeOf(instance);

        this.metadataScanner.scanFromPrototype(
          instance,
          prototype,
          (methodName: string) => {
            const methodRef = prototype[methodName];

            const permissions = this.reflector.get<string[]>(
              PERMISSIONS_KEY,
              methodRef,
            );

            const moduleName = this.reflector.get<string>(
              MODULE_KEY,
              methodRef,
            );

            if (!permissions || !moduleName) return;

            if (!result[moduleName]) {
              result[moduleName] = [];
            }

            for (const perm of permissions) {
              const exists = result[moduleName].some(
                (p) => p.name === perm,
              );

              if (!exists) {
                result[moduleName].push({
                  name: perm,
                });
              }
            }
          },
        );
      }
    }

    return result;
  }
}