import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { AuthUser } from '../types/auth-user.type';
import { JwtPayload } from '../types/jwt-payload.type';
import { isAuthenticationAllowed } from '../utils/is-authentication-allowed.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    /*
     * لا نثق بالدور أو clientId الموجودين داخل التوكن.
     * نعيد قراءة المستخدم والعميل من قاعدة البيانات.
     */
    const user = await this.usersService.findAuthUserById(payload.sub);

    if (!user || !isAuthenticationAllowed(user)) {
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
}
