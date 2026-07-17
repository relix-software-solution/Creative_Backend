import { OmitType } from '@nestjs/mapped-types';
import { CreateScanDto } from './create-scan.dto';

export class CreateDeviceScanDto extends OmitType(CreateScanDto, [
  'deviceId',
] as const) {}
