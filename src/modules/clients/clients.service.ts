import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { hashPassword } from '../../common/utils/password.util';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { CreateClientWithAccessAccountDto } from './dto/create-client-with-access-account.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { CreateClientAccessAccountDto } from './dto/create-client-access-account.dto';
import { UpdateClientAccessAccountDto } from './dto/update-client-access-account.dto';

/*
 * نستخدم select صريحًا للمسارات القديمة حتى لا يظهر primaryUserId
 * ضمن Responses القديمة بعد إضافته إلى Prisma.
 */
const legacyClientSelect = {
  id: true,
  name: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

/*
 * الحقول المسموح بإرجاعها لحساب العميل.
 * passwordHash غير موجود عمدًا.
 */
const accessAccountSelect = {
  id: true,
  clientId: true,
  email: true,
  phone: true,
  fullName: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

type ClientAccountDb = Pick<
  Prisma.TransactionClient,
  'client' | 'user' | 'refreshToken'
>;

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  /*
   * المسار القديم:
   * يبقى ينشئ Client فقط.
   */
  async create(createClientDto: CreateClientDto) {
    await this.ensureActiveNameIsUnique(createClientDto.name);

    return this.prisma.client.create({
      data: createClientDto,
      select: legacyClientSelect,
    });
  }

  /*
   * المسار الجديد:
   * ينشئ Client + CLIENT_VIEWER ضمن Transaction واحدة.
   */
  async createWithAccessAccount(dto: CreateClientWithAccessAccountDto) {
    /*
     * Hash خارج الـTransaction لتقليل مدة قفل اتصال قاعدة البيانات.
     * لا توجد أي كتابة في قاعدة البيانات قبل نجاح الـTransaction.
     */
    const passwordHash = await hashPassword(dto.accessAccount.password);

    /*
     * fullName اختياري بالطلب.
     * عند عدم إرساله نستخدم contactName، ثم اسم العميل.
     */
    const fullName =
      dto.accessAccount.fullName?.trim() ||
      dto.client.contactName?.trim() ||
      dto.client.name.trim();

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.ensureActiveNameIsUnique(dto.client.name, undefined, tx);

        await this.ensureAccessAccountIdentifiersAreUnique(
          dto.accessAccount.email,
          dto.accessAccount.phone,
          tx,
        );

        const client = await tx.client.create({
          data: dto.client,
          select: legacyClientSelect,
        });

        const accessAccount = await tx.user.create({
          data: {
            clientId: client.id,
            email: dto.accessAccount.email,
            phone: dto.accessAccount.phone,
            passwordHash,
            fullName,
            role: UserRole.CLIENT_VIEWER,
            status: UserStatus.ACTIVE,
          },
          select: accessAccountSelect,
        });

        await tx.client.update({
          where: { id: client.id },
          data: {
            primaryUserId: accessAccount.id,
          },
        });

        return {
          client,
          accessAccount,
        };
      });
    } catch (error) {
      this.rethrowKnownUniqueError(error);
    }
  }

  async createAccessAccount(
    clientId: string,
    dto: CreateClientAccessAccountDto,
  ) {
    const passwordHash = await hashPassword(dto.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const client = await tx.client.findUnique({
          where: { id: clientId },
          select: {
            ...legacyClientSelect,
            primaryUserId: true,
          },
        });

        if (!client) {
          throw new NotFoundException('Client not found');
        }

        if (client.primaryUserId) {
          throw new ConflictException(
            'Client already has a primary access account',
          );
        }

        await this.ensureAccessAccountIdentifiersAreUnique(
          dto.email,
          dto.phone,
          tx,
        );

        const accessAccount = await tx.user.create({
          data: {
            clientId,
            email: dto.email,
            phone: dto.phone,
            passwordHash,
            fullName:
              dto.fullName?.trim() ||
              client.contactName?.trim() ||
              client.name.trim(),
            role: UserRole.CLIENT_VIEWER,
            status: UserStatus.ACTIVE,
          },
          select: accessAccountSelect,
        });

        /*
         * updateMany يحمينا من طلبين متزامنين يحاولان
         * إنشاء حساب أساسي للعميل نفسه.
         */
        const linkResult = await tx.client.updateMany({
          where: {
            id: clientId,
            primaryUserId: null,
          },
          data: {
            primaryUserId: accessAccount.id,
          },
        });

        if (linkResult.count !== 1) {
          throw new ConflictException(
            'Client already has a primary access account',
          );
        }

        const { primaryUserId: _primaryUserId, ...safeClient } = client;

        return {
          client: safeClient,
          accessAccount,
        };
      });
    } catch (error) {
      this.rethrowKnownUniqueError(error);
    }
  }

  async getAccessAccount(clientId: string) {
    const { accessAccount } =
      await this.findPrimaryAccessAccountOrThrow(clientId);

    return accessAccount;
  }

  async updateAccessAccount(
    clientId: string,
    dto: UpdateClientAccessAccountDto,
  ) {
    if (
      dto.fullName === undefined &&
      dto.email === undefined &&
      dto.phone === undefined
    ) {
      throw new BadRequestException(
        'At least one access account field is required',
      );
    }

    const { accessAccount } =
      await this.findPrimaryAccessAccountOrThrow(clientId);

    const nextEmail = dto.email === undefined ? accessAccount.email : dto.email;

    const nextPhone = dto.phone === undefined ? accessAccount.phone : dto.phone;

    if (!nextEmail && !nextPhone) {
      throw new BadRequestException('Either email or phone is required');
    }

    await this.ensureAccessAccountIdentifiersAreUnique(
      nextEmail,
      nextPhone ?? undefined,
      this.prisma,
      accessAccount.id,
    );

    const identifierChanged =
      nextEmail !== accessAccount.email || nextPhone !== accessAccount.phone;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updatedAccessAccount = await tx.user.update({
          where: {
            id: accessAccount.id,
          },
          data: {
            fullName: dto.fullName,
            email: nextEmail,
            phone: nextPhone,
          },
          select: accessAccountSelect,
        });

        /*
         * إذا تغيّر البريد أو الهاتف، نلغي الجلسات الحالية
         * لأنهما يستخدمان كبيانات تسجيل دخول.
         */
        if (identifierChanged) {
          await tx.refreshToken.updateMany({
            where: {
              userId: accessAccount.id,
              revokedAt: null,
            },
            data: {
              revokedAt: new Date(),
            },
          });
        }

        return updatedAccessAccount;
      });
    } catch (error) {
      this.rethrowKnownUniqueError(error);
    }
  }

  async resetAccessAccountPassword(clientId: string, newPassword: string) {
    const { accessAccount } =
      await this.findPrimaryAccessAccountOrThrow(clientId);

    const passwordHash = await hashPassword(newPassword);
    const revokedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: {
          id: accessAccount.id,
        },
        data: {
          passwordHash,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId: accessAccount.id,
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      }),
    ]);

    return {
      reset: true,
    };
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
        orderBy: {
          createdAt: 'desc',
        },
        select: legacyClientSelect,
      }),
      this.prisma.client.count({
        where,
      }),
    ]);

    return createPaginatedResponse(items, total, page, limit);
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: {
        id,
      },
      select: legacyClientSelect,
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
      where: {
        id,
      },
      data: updateClientDto,
      select: legacyClientSelect,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    const client = await this.prisma.client.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
      select: legacyClientSelect,
    });

    return {
      deactivated: true,
      client,
    };
  }

  private async ensureActiveNameIsUnique(
    name: string,
    excludeId?: string,
    db: ClientAccountDb = this.prisma,
  ) {
    const existingClient = await db.client.findFirst({
      where: {
        name,
        isActive: true,
        ...(excludeId
          ? {
              id: {
                not: excludeId,
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingClient) {
      throw new ConflictException('Client name already exists');
    }
  }

  private async ensureAccessAccountIdentifiersAreUnique(
    email?: string | null,
    phone?: string | null,
    db: ClientAccountDb = this.prisma,
    excludeUserId?: string,
  ) {
    if (!email && !phone) {
      throw new BadRequestException('Either email or phone is required');
    }

    const existingUser = await db.user.findFirst({
      where: {
        ...(excludeUserId
          ? {
              id: {
                not: excludeUserId,
              },
            }
          : {}),
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
      select: {
        id: true,
      },
    });

    if (existingUser) {
      throw new ConflictException('Email or phone already exists');
    }
  }
  private async findPrimaryAccessAccountOrThrow(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: {
        id: clientId,
      },
      select: {
        id: true,
        name: true,
        primaryUserId: true,
        primaryUser: {
          select: accessAccountSelect,
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    if (!client.primaryUserId || !client.primaryUser) {
      throw new NotFoundException('Client access account not found');
    }

    if (
      client.primaryUser.role !== UserRole.CLIENT_VIEWER ||
      client.primaryUser.clientId !== client.id
    ) {
      throw new ConflictException('Client primary access account is invalid');
    }

    if (client.primaryUser.status === UserStatus.DELETED) {
      throw new BadRequestException('Client access account is deleted');
    }

    return {
      client,
      accessAccount: client.primaryUser,
    };
  }

  private rethrowKnownUniqueError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Email or phone already exists');
    }

    throw error;
  }
}
