import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';

const SETTINGS_ID = 'system';

@Injectable()
export class AdminSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    return this.prisma.adminSetting.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  }

  async updateSettings(dto: UpdateAdminSettingsDto) {
    return this.prisma.adminSetting.upsert({
      where: { id: SETTINGS_ID },
      update: dto,
      create: {
        id: SETTINGS_ID,
        ...dto,
      },
    });
  }
}
