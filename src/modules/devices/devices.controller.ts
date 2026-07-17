import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentDevice as CurrentDeviceDecorator } from '../../common/decorators/current-device.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeviceAuthGuard } from '../../common/guards/device-auth.guard';
import type { CurrentDevice } from '../../common/types/current-device.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RedisService } from '../queue/redis.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateDeviceScanDto } from '../scans/dto/create-device-scan.dto';
import { ScansService } from '../scans/scans.service';
import { SubmitDeviceSyncBatchDto } from '../sync/dto/submit-device-sync-batch.dto';
import { SyncService } from '../sync/sync.service';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { ListDevicesQueryDto } from './dto/list-devices-query.dto';
import { ProvisionOfflineKeyDto } from './dto/provision-offline-key.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  create(@Body() createDeviceDto: CreateDeviceDto) {
    return this.devicesService.create(createDeviceDto);
  }

  @Get()
  findAll(@Query() query: ListDevicesQueryDto) {
    return this.devicesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDeviceDto: UpdateDeviceDto) {
    return this.devicesService.update(id, updateDeviceDto);
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string) {
    return this.devicesService.revoke(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.devicesService.remove(id);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.devicesService.activate(id);
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string) {
    return this.devicesService.suspend(id);
  }

  @Post(':id/rotate-api-key')
  rotateApiKey(@Param('id') id: string) {
    return this.devicesService.rotateApiKey(id);
  }

  @Post(':id/offline-key')
  provisionOfflineKey(
    @Param('id') id: string,
    @Body() provisionOfflineKeyDto: ProvisionOfflineKeyDto,
  ) {
    return this.devicesService.provisionOfflineKey(
      id,
      provisionOfflineKeyDto,
    );
  }

  @Post(':id/offline-key/rotate')
  rotateOfflineKey(
    @Param('id') id: string,
    @Body() provisionOfflineKeyDto: ProvisionOfflineKeyDto,
  ) {
    return this.devicesService.rotateOfflineKey(id, provisionOfflineKeyDto);
  }
}

@Controller('device')
@UseGuards(DeviceAuthGuard)
export class DeviceController {
  constructor(
    private readonly redisService: RedisService,
    private readonly scansService: ScansService,
    private readonly syncService: SyncService,
    private readonly devicesService: DevicesService,
  ) {}

  @Get('me')
  me(@CurrentDeviceDecorator() device: CurrentDevice) {
    return device;
  }

  @Get('offline-trust-bundle')
  offlineTrustBundle(@CurrentDeviceDecorator() device: CurrentDevice) {
    return this.devicesService.getOfflineTrustBundle(device.id);
  }

  @Post('scans/fast')
  @HttpCode(HttpStatus.ACCEPTED)
  fastScan(
    @CurrentDeviceDecorator() device: CurrentDevice,
    @Body() createDeviceScanDto: CreateDeviceScanDto,
  ) {
    this.assertDeviceEvent(device, createDeviceScanDto.eventId);

    return this.scansService.ingestFast({
      ...createDeviceScanDto,
      deviceId: device.id,
    });
  }

  @Post('scans/redis-fast')
  @HttpCode(HttpStatus.ACCEPTED)
  redisFastScan(
    @CurrentDeviceDecorator() device: CurrentDevice,
    @Body() createDeviceScanDto: CreateDeviceScanDto,
  ) {
    this.assertDeviceEvent(device, createDeviceScanDto.eventId);

    return this.redisService.enqueueRawScan({
      ...createDeviceScanDto,
      deviceId: device.id,
    });
  }

  @Post('scans')
  scan(
    @CurrentDeviceDecorator() device: CurrentDevice,
    @Body() createDeviceScanDto: CreateDeviceScanDto,
  ) {
    this.assertDeviceEvent(device, createDeviceScanDto.eventId);

    return this.scansService.ingest({
      ...createDeviceScanDto,
      deviceId: device.id,
    });
  }

  @Post('sync/batches')
  submitSyncBatch(
    @CurrentDeviceDecorator() device: CurrentDevice,
    @Body() submitDeviceSyncBatchDto: SubmitDeviceSyncBatchDto,
  ) {
    this.assertDeviceEvent(device, submitDeviceSyncBatchDto.eventId);

    return this.syncService.submitBatch({
      ...submitDeviceSyncBatchDto,
      deviceId: device.id,
    });
  }

  private assertDeviceEvent(device: CurrentDevice, eventId: string) {
    if (device.eventId !== eventId) {
      throw new ForbiddenException('Device cannot access a different event');
    }
  }
}
