import { Module } from '@nestjs/common';
import { StaffAssignmentsController } from './staff-assignments.controller';
import { StaffAssignmentsService } from './staff-assignments.service';

@Module({
  controllers: [StaffAssignmentsController],
  providers: [StaffAssignmentsService],
})
export class StaffAssignmentsModule {}
