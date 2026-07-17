import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { hashPassword } from '../../common/utils/password.util';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  findByEmailOrPhone(identifier: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
    });
  }

  async create(createUserDto: CreateUserDto) {
    this.ensureEmailOrPhone(createUserDto.email, createUserDto.phone);
    await this.ensureEmailAndPhoneAreUnique(
      createUserDto.email,
      createUserDto.phone,
    );

    const clientId = await this.resolveClientIdForRole(
      createUserDto.role,
      createUserDto.clientId,
    );
    const user = await this.prisma.user.create({
      data: {
        fullName: createUserDto.fullName,
        email: createUserDto.email,
        phone: createUserDto.phone,
        role: createUserDto.role,
        clientId,
        status: UserStatus.ACTIVE,
        passwordHash: await hashPassword(createUserDto.password),
      },
    });

    return this.sanitizeUser(user);
  }

  async findAll(query: ListUsersQueryDto) {
    const { page, limit, skip } = normalizePagination(query);
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search } },
              { email: { contains: query.search } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return createPaginatedResponse(
      users.map((user) => this.sanitizeUser(user)),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string) {
    const user = await this.findUserOrThrow(id);

    return this.sanitizeUser(user);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findUserOrThrow(id);

    if (user.status === UserStatus.DELETED) {
      throw new BadRequestException('Deleted users cannot be updated');
    }

    const email =
      updateUserDto.email === undefined ? user.email : updateUserDto.email;
    const phone =
      updateUserDto.phone === undefined ? user.phone : updateUserDto.phone;
    this.ensureEmailOrPhone(email, phone);
    await this.ensureEmailAndPhoneAreUnique(email, phone, id);

    const role = updateUserDto.role ?? user.role;
    const clientId = await this.resolveClientIdForRole(
      role,
      updateUserDto.clientId === undefined ? user.clientId : updateUserDto.clientId,
    );
    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: updateUserDto.fullName,
        email,
        phone,
        role,
        clientId,
      },
    });

    return this.sanitizeUser(updatedUser);
  }

  async activate(id: string) {
    await this.findUserOrThrow(id);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
    });

    return this.sanitizeUser(user);
  }

  async suspend(id: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException('You cannot suspend your own user');
    }

    await this.findUserOrThrow(id);

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.SUSPENDED },
    });

    return this.sanitizeUser(user);
  }

  async delete(id: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException('You cannot delete your own user');
    }

    await this.findUserOrThrow(id);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
      },
    });

    return this.sanitizeUser(user);
  }

  async resetPassword(id: string, newPassword: string) {
    await this.findUserOrThrow(id);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(newPassword) },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId: id,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { reset: true };
  }

  sanitizeUser(user: User) {
    const { passwordHash: _passwordHash, ...safeUser } = user;

    return safeUser;
  }

  private async findUserOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private ensureEmailOrPhone(email?: string | null, phone?: string | null) {
    if (!email && !phone) {
      throw new BadRequestException('Either email or phone is required');
    }
  }

  private async ensureEmailAndPhoneAreUnique(
    email?: string | null,
    phone?: string | null,
    excludeId?: string,
  ) {
    if (!email && !phone) {
      return;
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      },
    });

    if (existingUser) {
      throw new ConflictException('Email or phone already exists');
    }
  }

  private async resolveClientIdForRole(
    role: UserRole,
    clientId?: string | null,
  ) {
    if (role !== UserRole.CLIENT_VIEWER) {
      return null;
    }

    if (!clientId) {
      throw new BadRequestException('clientId is required for CLIENT_VIEWER');
    }

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return clientId;
  }
}
