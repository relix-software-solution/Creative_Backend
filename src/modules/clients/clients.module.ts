import { Module } from '@nestjs/common';
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientLifecycleService],
})
export class ClientsModule {}
