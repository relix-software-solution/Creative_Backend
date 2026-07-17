import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { comparePassword } from '../../common/utils/password.util';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthUser } from './types/auth-user.type';
import { JwtPayload } from './types/jwt-payload.type';
import { hashRefreshToken } from './utils/refresh-token.util';

const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async validateUserByEmailOrPhone(
    identifier: string,
    password: string,
  ): Promise<AuthUser> {
    const user = await this.usersService.findByEmailOrPhone(identifier);

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      clientId: user.clientId,
    };
  }

  async login(identifier: string, password: string) {
    const user = await this.validateUserByEmailOrPhone(identifier, password);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { accessToken, refreshToken } = await this.issueTokens(user);
    await this.storeRefreshToken(user.id, refreshToken);

    return {
      user,
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    const payload = await this.verifyRefreshToken(refreshToken);
    const tokenHash = hashRefreshToken(refreshToken);
    const storedRefreshToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    const now = new Date();

    if (
      !storedRefreshToken ||
      storedRefreshToken.revokedAt ||
      storedRefreshToken.expiresAt <= now ||
      storedRefreshToken.userId !== payload.sub
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const userRecord = await this.usersService.findById(payload.sub);

    if (!userRecord || userRecord.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user: AuthUser = {
      id: userRecord.id,
      fullName: userRecord.fullName,
      email: userRecord.email,
      phone: userRecord.phone,
      role: userRecord.role,
      clientId: userRecord.clientId,
    };
    const tokens = await this.issueTokens(user);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: storedRefreshToken.id },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hashRefreshToken(tokens.refreshToken),
          expiresAt: this.getRefreshTokenExpiresAt(),
        },
      }),
    ]);

    return {
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async logout(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    const storedRefreshToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (storedRefreshToken && !storedRefreshToken.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: storedRefreshToken.id },
        data: { revokedAt: new Date() },
      });
    }

    return { loggedOut: true };
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.usersService.findById(userId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid token');
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      clientId: user.clientId,
    };
  }

  private async issueTokens(user: AuthUser) {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      clientId: user.clientId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, refreshToken: string) {
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: this.getRefreshTokenExpiresAt(),
      },
    });
  }

  private async verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private getRefreshTokenExpiresAt(): Date {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_IN_DAYS);

    return expiresAt;
  }
}
