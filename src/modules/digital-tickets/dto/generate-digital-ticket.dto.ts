import { IsOptional, IsString } from 'class-validator';

export class GenerateDigitalTicketDto {
  @IsOptional()
  forceRegenerate?: boolean;

  @IsOptional()
  @IsString()
  requestBaseUrl?: string;
}
