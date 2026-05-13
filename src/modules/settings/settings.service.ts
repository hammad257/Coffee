import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserActivityType } from '@prisma/client';
import DecimalPkg from 'decimal.js';
import type { Express } from 'express';
import { LocalFilesService } from '../../common/upload/local-files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PatchStoreSettingsDto } from './dto/settings.dto';

const SETTINGS_ID = 'default';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localFiles: LocalFilesService,
  ) {}

  private async ensureStoreRow() {
    await this.prisma.storeSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        storeName: 'Élite de Paris',
      },
      update: {},
    });
  }

  async getStore() {
    await this.ensureStoreRow();
    const s = await this.prisma.storeSettings.findUniqueOrThrow({
      where: { id: SETTINGS_ID },
    });
    return this.present(s);
  }

  private present(s: {
    id: string;
    storeName: string;
    address: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    storeLogoUrl: string | null;
    currencyCode: string;
    timezone: string;
    taxEnabled: boolean;
    taxInclusive: boolean;
    taxRate: unknown;
    paymentCashEnabled: boolean;
    paymentCardEnabled: boolean;
    paymentOnlineEnabled: boolean;
    lowStockAlertsEnabled: boolean;
    orderSoundEnabled: boolean;
    autoPrintReceipts: boolean;
    createdAt: Date;
    updatedAt: Date;
    updatedById: string | null;
  }) {
    return {
      ...s,
      taxRate: Number(s.taxRate),
      storeLogoUrl: this.localFiles.toAbsoluteAssetUrl(s.storeLogoUrl),
    };
  }

  async patchStore(actorId: string, dto: PatchStoreSettingsDto) {
    await this.ensureStoreRow();
    const data: Prisma.StoreSettingsUpdateInput = { updatedById: actorId };
    if (dto.storeName !== undefined) data.storeName = dto.storeName;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.currencyCode !== undefined)
      data.currencyCode = dto.currencyCode.trim().toUpperCase();
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.taxEnabled !== undefined) data.taxEnabled = dto.taxEnabled;
    if (dto.taxInclusive !== undefined) data.taxInclusive = dto.taxInclusive;
    if (dto.taxRate !== undefined)
      data.taxRate = new DecimalPkg(dto.taxRate).toFixed(4);
    if (dto.paymentCashEnabled !== undefined)
      data.paymentCashEnabled = dto.paymentCashEnabled;
    if (dto.paymentCardEnabled !== undefined)
      data.paymentCardEnabled = dto.paymentCardEnabled;
    if (dto.paymentOnlineEnabled !== undefined)
      data.paymentOnlineEnabled = dto.paymentOnlineEnabled;
    if (dto.lowStockAlertsEnabled !== undefined)
      data.lowStockAlertsEnabled = dto.lowStockAlertsEnabled;
    if (dto.orderSoundEnabled !== undefined)
      data.orderSoundEnabled = dto.orderSoundEnabled;
    if (dto.autoPrintReceipts !== undefined)
      data.autoPrintReceipts = dto.autoPrintReceipts;

    await this.prisma.storeSettings.update({
      where: { id: SETTINGS_ID },
      data,
    });

    await this.prisma.userActivity.create({
      data: {
        userId: actorId,
        activityType: UserActivityType.SETTINGS_UPDATED,
        title: 'Store settings updated',
        meta: {
          patchKeys: Object.keys(dto),
        } as Prisma.InputJsonValue,
      },
    });

    return this.getStore();
  }

  async setStoreLogo(actorId: string, file: Express.Multer.File | undefined) {
    if (!file?.filename) {
      throw new BadRequestException(
        'Logo file is required (multipart field name: file).',
      );
    }
    await this.ensureStoreRow();
    const prev = await this.prisma.storeSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { storeLogoUrl: true },
    });
    this.localFiles.removeManagedFile(prev?.storeLogoUrl);
    const relative = this.localFiles.publicPath('store', file.filename);
    await this.prisma.storeSettings.update({
      where: { id: SETTINGS_ID },
      data: { storeLogoUrl: relative, updatedById: actorId },
    });
    await this.prisma.userActivity.create({
      data: {
        userId: actorId,
        activityType: UserActivityType.SETTINGS_UPDATED,
        title: 'Store logo updated',
      },
    });
    return this.getStore();
  }
}
