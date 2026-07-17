import { Module } from '@nestjs/common';
import { RegistrationFieldsController } from './registration-fields.controller';
import { RegistrationFieldsService } from './registration-fields.service';

@Module({
  controllers: [RegistrationFieldsController],
  providers: [RegistrationFieldsService],
})
export class RegistrationFieldsModule {}
