import { Module } from '@nestjs/common';
import { AttendeeTypesController } from './attendee-types.controller';
import { AttendeeTypesService } from './attendee-types.service';

@Module({
  controllers: [AttendeeTypesController],
  providers: [AttendeeTypesService],
})
export class AttendeeTypesModule {}
