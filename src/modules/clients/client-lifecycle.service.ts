import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const lifecycleClientSelect = {
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

@Injectable()
export class ClientLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async setActiveStatus(id: string, isActive: boolean) {
    const existingClient = await this.prisma.client.findUnique({
      where: { id },
      select: lifecycleClientSelect,
    });

    if (!existingClient) {
      throw new NotFoundException('Client not found');
    }

    if (existingClient.isActive === isActive) {
      return {
        changed: false,
        client: existingClient,
      };
    }

    const client = await this.prisma.$transaction(async (tx) => {
      const updatedClient = await tx.client.update({
        where: { id },
        data: { isActive },
        select: lifecycleClientSelect,
      });

      if (!isActive) {
        await tx.refreshToken.updateMany({
          where: {
            revokedAt: null,
            user: {
              is: {
                clientId: id,
              },
            },
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }

      return updatedClient;
    });

    return {
      changed: true,
      client,
    };
  }

  async deletePermanently(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isActive: true,
        _count: {
          select: {
            events: true,
            users: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    if (client.isActive) {
      throw new ConflictException(
        'Deactivate the client before permanent deletion',
      );
    }

    if (client._count.events > 0) {
      throw new ConflictException(
        'Client has related events and cannot be permanently deleted. Keep it deactivated to preserve event history.',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const clientUsers = await tx.user.findMany({
          where: { clientId: id },
          select: { id: true },
        });

        const userIds = clientUsers.map((user) => user.id);
        const deletedAt = new Date();

        /*
         * نفك العلاقة الدائرية أولًا:
         * Client.primaryUserId -> User.id
         * User.clientId -> Client.id
         */
        await tx.client.update({
          where: { id },
          data: { primaryUserId: null },
        });

        if (userIds.length > 0) {
          await tx.refreshToken.updateMany({
            where: {
              userId: { in: userIds },
              revokedAt: null,
            },
            data: {
              revokedAt: deletedAt,
            },
          });

          /*
           * لا نحذف User فعليًا حتى لا نكسر AuditLog أو أي سجل تاريخي.
           * نحوله إلى Tombstone غير قابل للدخول ونحرر البريد والهاتف.
           */
          await tx.user.updateMany({
            where: {
              id: { in: userIds },
            },
            data: {
              clientId: null,
              status: UserStatus.DELETED,
              deletedAt,
              email: null,
              phone: null,
              fullName: 'Deleted client account',
            },
          });
        }

        await tx.client.delete({
          where: { id },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Client still has related records and cannot be permanently deleted',
        );
      }

      throw error;
    }

    return {
      deleted: true,
      id,
    };
  }
}
