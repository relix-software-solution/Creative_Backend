import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateClientAccessAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
