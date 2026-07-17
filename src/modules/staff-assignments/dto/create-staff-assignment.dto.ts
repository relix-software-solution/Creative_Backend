import { IsOptional, IsString } from 'class-validator';

export class CreateStaffAssignmentDto {
  @IsString()
  eventId: string;

  @IsString()
  userId: string;

  @IsString()
  checkpointId: string;

  @IsString()
  deviceId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
