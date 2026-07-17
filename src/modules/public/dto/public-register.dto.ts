import { OmitType } from '@nestjs/mapped-types';
import { CreateRegistrationDto } from '../../registrations/dto/create-registration.dto';

export class PublicRegisterDto extends OmitType(CreateRegistrationDto, [
  'eventId',
] as const) {}
