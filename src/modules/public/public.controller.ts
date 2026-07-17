import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ListPublicEventsQueryDto } from './dto/list-public-events-query.dto';
import { PublicRegisterDto } from './dto/public-register.dto';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('events')
  findEvents(@Query() query: ListPublicEventsQueryDto) {
    return this.publicService.findEvents(query);
  }

  @Get('events/:id')
  findEvent(@Param('id') id: string) {
    return this.publicService.findEvent(id);
  }

  @Post('events/:id/register')
  register(@Param('id') id: string, @Body() dto: PublicRegisterDto) {
    return this.publicService.register(id, dto);
  }

  @Get('registrations/:publicId/digital-ticket')
  findDigitalTicket(
    @Param('publicId') publicId: string,
    @Query('token') token?: string,
  ) {
    return this.publicService.findDigitalTicket(publicId, token);
  }
}
