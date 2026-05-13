import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { UploadSubdir } from './multer-image.config';

@Injectable()
export class LocalFilesService implements OnModuleInit {
  private readonly logger = new Logger(LocalFilesService.name);

  constructor(private readonly config: ConfigService) {}

  /** Base used in API responses (`photoUrl`, `imageUrl`). Env `PUBLIC_BASE_URL` or `http://localhost:${PORT}`. */
  private publicBaseUrl(): string {
    const fromEnv = this.config.get<string>('PUBLIC_BASE_URL')?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const portRaw = this.config.get('PORT');
    const parsed =
      typeof portRaw === 'string' ? parseInt(portRaw, 10) : Number(portRaw);
    const port =
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3000;
    return `http://localhost:${port}`;
  }

  /**
   * Turn stored `/uploads/…` paths into browser-openable URLs (e.g. `http://localhost:3000/uploads/users/….jpg`).
   * Leaves already-absolute URLs and non-local paths unchanged.
   */
  toAbsoluteAssetUrl(storedValue: string | null | undefined): string | null {
    if (!storedValue?.trim()) return null;
    const v = storedValue.trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (!v.startsWith('/uploads/')) return v;
    return `${this.publicBaseUrl()}${v}`;
  }

  /** `/uploads/…` substring for deletes, whether DB has relative path or stored absolute URL. */
  uploadsRelativePath(ref: string | null | undefined): string | undefined {
    if (!ref?.trim()) return undefined;
    const v = ref.trim();
    const i = v.indexOf('/uploads/');
    if (i !== -1) return v.slice(i);
    return undefined;
  }


  onModuleInit() {
    for (const d of ['users', 'products', 'categories', 'store'] as UploadSubdir[]) {
      const p = join(process.cwd(), 'uploads', d);
      if (!existsSync(p)) mkdirSync(p, { recursive: true });
    }
  }

  /** Path stored in DB (relative — always `/uploads/…`). */
  publicPath(subdir: UploadSubdir, filename: string): string {
    return `/uploads/${subdir}/${filename}`;
  }

  /** Best-effort delete of a local upload (relative `/uploads/…` or full URL ending in `/uploads/…`). */
  removeManagedFile(publicUrlPath: string | null | undefined): void {
    const relative = this.uploadsRelativePath(publicUrlPath);
    if (!relative?.startsWith('/uploads/')) return;
    const rel = relative.slice(1);
    if (!rel.startsWith('uploads/')) return;
    const abs = join(process.cwd(), rel);
    try {
      if (existsSync(abs)) unlinkSync(abs);
    } catch {
      this.logger.warn(`Could not delete upload file: ${abs}`);
    }
  }
}
