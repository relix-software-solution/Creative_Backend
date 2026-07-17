import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { hashApiKey } from '../utils/api-key.util';
import { PrismaService } from '../../database/prisma.service';
import { CurrentDevice } from '../types/current-device.type';

type RequestWithDevice = {
  headers: Record<string, string | string[] | undefined>;
  device?: CurrentDevice;
};

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithDevice>();
    const rawApiKey = this.getApiKey(request);

    if (!rawApiKey) {
      throw new UnauthorizedException('Device API key is required');
    }

    const device = await this.prisma.device.findUnique({
      where: { apiKeyHash: hashApiKey(rawApiKey) },
    });

    if (!device || device.status !== DeviceStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid device API key');
    }

    const { apiKeyHash: _apiKeyHash, ...safeDevice } = device;
    request.device = safeDevice;

    return true;
  }

  private getApiKey(request: RequestWithDevice) {
    const header =
      request.headers['x-device-api-key'] ??
      request.headers['X-Device-Api-Key'];

    if (Array.isArray(header)) {
      return header[0];
    }

    return header;
  }
}
