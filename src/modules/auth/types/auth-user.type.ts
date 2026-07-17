import { UserRole } from '@prisma/client';

export type AuthUser = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  clientId: string | null;
};
