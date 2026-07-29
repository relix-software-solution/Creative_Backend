import { IsBoolean } from 'class-validator';

export class SetClientActiveStatusDto {
  @IsBoolean()
  isActive: boolean;
}
