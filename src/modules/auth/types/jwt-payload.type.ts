import { UserRole } from '@prisma/client';

export type JwtPayload = {
  sub: string;
  role: UserRole;
  clientId?: string | null;
};
