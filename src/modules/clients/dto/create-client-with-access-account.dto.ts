import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';
import { CreateClientAccessAccountDto } from './create-client-access-account.dto';
import { CreateClientDto } from './create-client.dto';

export class CreateClientWithAccessAccountDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateClientDto)
  client: CreateClientDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => CreateClientAccessAccountDto)
  accessAccount: CreateClientAccessAccountDto;
}
