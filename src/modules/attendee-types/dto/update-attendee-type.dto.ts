import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateAttendeeTypeDto } from './create-attendee-type.dto';

export class UpdateAttendeeTypeDto extends PartialType(
  OmitType(CreateAttendeeTypeDto, ['eventId'] as const),
) {}
