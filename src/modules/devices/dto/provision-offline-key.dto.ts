import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class ProvisionOfflineKeyDto {
  @IsString()
  publicKey: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  keyVersion: number;
}
