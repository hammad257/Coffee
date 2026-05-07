import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'module';

export const ModuleName = (module: string) => SetMetadata(MODULE_KEY, module);
