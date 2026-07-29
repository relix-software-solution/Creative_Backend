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
import { ClientLifecycleService } from './client-lifecycle.service';
import { ClientsService } from './clients.service';
import { CreateClientAccessAccountDto } from './dto/create-client-access-account.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientWithAccessAccountDto } from './dto/create-client-with-access-account.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { ResetClientAccessAccountPasswordDto } from './dto/reset-client-access-account-password.dto';
import { SetClientActiveStatusDto } from './dto/set-client-active-status.dto';
import { UpdateClientAccessAccountDto } from './dto/update-client-access-account.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientLifecycleService: ClientLifecycleService,
  ) {}

  @Post()
  create(@Body() createClientDto: CreateClientDto) {
    return this.clientsService.create(createClientDto);
  }

  @Post('with-access-account')
  createWithAccessAccount(
    @Body() dto: CreateClientWithAccessAccountDto,
  ) {
    return this.clientsService.createWithAccessAccount(dto);
  }

  @Get()
  findAll(@Query() query: ListClientsQueryDto) {
    return this.clientsService.findAll(query);
  }

  @Post(':id/access-account')
  createAccessAccount(
    @Param('id') id: string,
    @Body() dto: CreateClientAccessAccountDto,
  ) {
    return this.clientsService.createAccessAccount(id, dto);
  }

  @Get(':id/access-account')
  getAccessAccount(@Param('id') id: string) {
    return this.clientsService.getAccessAccount(id);
  }

  @Patch(':id/access-account')
  updateAccessAccount(
    @Param('id') id: string,
    @Body() dto: UpdateClientAccessAccountDto,
  ) {
    return this.clientsService.updateAccessAccount(id, dto);
  }

  @Post(':id/access-account/reset-password')
  resetAccessAccountPassword(
    @Param('id') id: string,
    @Body() dto: ResetClientAccessAccountPasswordDto,
  ) {
    return this.clientsService.resetAccessAccountPassword(
      id,
      dto.newPassword,
    );
  }

  /**
   * تعطيل أو إعادة تفعيل العميل بدون حذف بياناته.
   */
  @Patch(':id/status')
  setActiveStatus(
    @Param('id') id: string,
    @Body() dto: SetClientActiveStatusDto,
  ) {
    return this.clientLifecycleService.setActiveStatus(
      id,
      dto.isActive,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    return this.clientsService.update(id, updateClientDto);
  }

  /**
   * حذف دائم. لا يُسمح به قبل التعطيل أو عند وجود فعاليات.
   */
  @Delete(':id')
  deletePermanently(@Param('id') id: string) {
    return this.clientLifecycleService.deletePermanently(id);
  }
}
