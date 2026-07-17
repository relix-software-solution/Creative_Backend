import { Module } from '@nestjs/common';
import { CheckpointsController } from './checkpoints.controller';
import { CheckpointsService } from './checkpoints.service';

@Module({
  controllers: [CheckpointsController],
  providers: [CheckpointsService],
})
export class CheckpointsModule {}
