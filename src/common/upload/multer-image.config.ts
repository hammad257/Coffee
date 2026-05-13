import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export type UploadSubdir = 'users' | 'products' | 'categories' | 'store';

const ALLOWED_MIME = /^image\/(jpeg|pjpeg|png|gif|webp)$/i;

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function extFromOriginal(originalname: string, mimetype: string): string {
  const ext = extname(originalname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return ext;
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/gif') return '.gif';
  if (mimetype === 'image/webp') return '.webp';
  return '.jpg';
}

export function multerImageOptions(subdir: UploadSubdir): MulterOptions {
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = join(process.cwd(), 'uploads', subdir);
        ensureDir(dir);
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        cb(
          null,
          `${randomUUID()}${extFromOriginal(file.originalname, file.mimetype)}`,
        );
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME.test(file.mimetype)) {
        cb(
          new BadRequestException(
            'Only image uploads are allowed (JPEG, PNG, GIF, WebP).',
          ),
          false,
        );
        return;
      }
      cb(null, true);
    },
  };
}
