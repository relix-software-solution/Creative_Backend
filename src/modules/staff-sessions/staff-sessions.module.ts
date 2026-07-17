import { Module } from '@nestjs/common';
import { StaffSessionsController } from './staff-sessions.controller';
import { StaffSessionsService } from './staff-sessions.service';

@Module({
  controllers: [StaffSessionsController],
  providers: [StaffSessionsService],
})
export class StaffSessionsModule {}
