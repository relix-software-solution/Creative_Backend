import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CheckpointsService } from './checkpoints.service';
import { CreateCheckpointDto } from './dto/create-checkpoint.dto';
import { ListCheckpointsQueryDto } from './dto/list-checkpoints-query.dto';
import { UpdateCheckpointDto } from './dto/update-checkpoint.dto';

@Controller('checkpoints')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class CheckpointsController {
  constructor(private readonly checkpointsService: CheckpointsService) {}

  @Post()
  create(@Body() createCheckpointDto: CreateCheckpointDto) {
    return this.checkpointsService.create(createCheckpointDto);
  }

  @Get()
  findAll(@Query() query: ListCheckpointsQueryDto) {
    return this.checkpointsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.checkpointsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCheckpointDto: UpdateCheckpointDto,
  ) {
    return this.checkpointsService.update(id, updateCheckpointDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.checkpointsService.remove(id);
  }
}
