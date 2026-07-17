import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Device, DeviceStatus, EventStatus, Prisma } from '@prisma/client';
import { generateApiKey, hashApiKey } from '../../common/utils/api-key.util';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { OfflineQrService } from '../offline/offline-qr.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { ListDevicesQueryDto } from './dto/list-devices-query.dto';
import { ProvisionOfflineKeyDto } from './dto/provision-offline-key.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

type DeviceResponse = Omit<Device, 'apiKeyHash'>;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly offlineQrService: OfflineQrService,
  ) {}

  async create(createDeviceDto: CreateDeviceDto) {
    await this.ensureEventCanBeModified(createDeviceDto.eventId);
    await this.ensureCodeIsUnique(createDeviceDto.code);

    const rawApiKey = generateApiKey('evtops_');
    const device = await this.prisma.device.create({
      data: {
        ...createDeviceDto,
        apiKeyHash: hashApiKey(rawApiKey),
        status: DeviceStatus.ACTIVE,
        metadata:
          createDeviceDto.metadata === undefined
            ? Prisma.JsonNull
            : (createDeviceDto.metadata as Prisma.InputJsonValue),
      },
    });

    return {
      device: this.toDeviceResponse(device),
      rawApiKey,
    };
  }

  async findAll(query: ListDevicesQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.DeviceWhereInput = {
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { code: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [devices, total] = await this.prisma.$transaction([
      this.prisma.device.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.device.count({ where }),
    ]);

    return createPaginatedResponse(
      devices.map((device) => this.toDeviceResponse(device)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string) {
    const device = await this.findDeviceOrThrow(id);

    return this.toDeviceResponse(device);
  }

  async update(id: string, updateDeviceDto: UpdateDeviceDto) {
    const device = await this.findDeviceOrThrow(id);
    await this.ensureEventCanBeModified(device.eventId);

    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: {
        ...updateDeviceDto,
        metadata:
          updateDeviceDto.metadata === undefined
            ? undefined
            : (updateDeviceDto.metadata as Prisma.InputJsonValue),
      },
    });

    return this.toDeviceResponse(updatedDevice);
  }

  async revoke(id: string) {
    return this.updateStatus(id, DeviceStatus.REVOKED);
  }

  async remove(id: string) {
    const device = await this.updateStatus(id, DeviceStatus.REVOKED);

    return { revoked: true, device };
  }

  async activate(id: string) {
    return this.updateStatus(id, DeviceStatus.ACTIVE);
  }

  async suspend(id: string) {
    return this.updateStatus(id, DeviceStatus.SUSPENDED);
  }

  async rotateApiKey(id: string) {
    const device = await this.findDeviceOrThrow(id);
    await this.ensureEventCanBeModified(device.eventId);

    const rawApiKey = generateApiKey('evtops_');
    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: {
        apiKeyHash: hashApiKey(rawApiKey),
      },
    });

    return {
      device: this.toDeviceResponse(updatedDevice),
      rawApiKey,
    };
  }

  async provisionOfflineKey(id: string, dto: ProvisionOfflineKeyDto) {
    const device = await this.findDeviceOrThrow(id);
    await this.ensureEventCanBeModified(device.eventId);

    return this.offlineQrService.provisionDevicePublicKey({
      deviceId: id,
      publicKey: dto.publicKey,
      keyVersion: dto.keyVersion,
    });
  }

  async rotateOfflineKey(id: string, dto: ProvisionOfflineKeyDto) {
    const device = await this.findDeviceOrThrow(id);
    await this.ensureEventCanBeModified(device.eventId);

    return this.offlineQrService.provisionDevicePublicKey({
      deviceId: id,
      publicKey: dto.publicKey,
      keyVersion: dto.keyVersion,
      rotateExisting: true,
    });
  }

  async getOfflineTrustBundle(id: string) {
    return this.offlineQrService.getTrustBundle(id);
  }

  private async updateStatus(id: string, status: DeviceStatus) {
    const device = await this.findDeviceOrThrow(id);
    await this.ensureEventCanBeModified(device.eventId);

    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: { status },
    });

    return this.toDeviceResponse(updatedDevice);
  }

  private async findDeviceOrThrow(id: string) {
    const device = await this.prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }

  private async ensureEventCanBeModified(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.status === EventStatus.ARCHIVED) {
      throw new BadRequestException('Archived events cannot be modified');
    }
  }

  private async ensureCodeIsUnique(code: string) {
    const existingDevice = await this.prisma.device.findUnique({
      where: { code },
    });

    if (existingDevice) {
      throw new ConflictException('Device code already exists');
    }
  }

  private toDeviceResponse(device: Device): DeviceResponse {
    const { apiKeyHash: _apiKeyHash, ...deviceResponse } = device;

    return deviceResponse;
  }
}
