import { PartialType } from '@nestjs/mapped-types';
import { CreateCheckpointDto } from './create-checkpoint.dto';

export class UpdateCheckpointDto extends PartialType(CreateCheckpointDto) {}
