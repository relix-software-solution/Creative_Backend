import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createClientDto: CreateClientDto) {
    await this.ensureActiveNameIsUnique(createClientDto.name);

    return this.prisma.client.create({
      data: createClientDto,
    });
  }

  async findAll(query: ListClientsQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.ClientWhereInput = {
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { contactName: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.count({ where }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return client;
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    await this.findOne(id);

    if (updateClientDto.name) {
      await this.ensureActiveNameIsUnique(updateClientDto.name, id);
    }

    return this.prisma.client.update({
      where: { id },
      data: updateClientDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    const client = await this.prisma.client.update({
      where: { id },
      data: { isActive: false },
    });

    return { deactivated: true, client };
  }

  private async ensureActiveNameIsUnique(name: string, excludeId?: string) {
    const existingClient = await this.prisma.client.findFirst({
      where: {
        name,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existingClient) {
      throw new ConflictException('Client name already exists');
    }
  }
}
