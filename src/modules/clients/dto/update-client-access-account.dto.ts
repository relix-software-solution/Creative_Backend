import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateClientAccessAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  /**
   * يمكن إرسال null لحذف رقم الهاتف.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;
}
