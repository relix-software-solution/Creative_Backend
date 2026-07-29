import { UserRole, UserStatus } from '@prisma/client';

export type AuthenticationCandidate = {
  status: UserStatus;
  role: UserRole;
  clientId: string | null;
  client: {
    id: string;
    isActive: boolean;
  } | null;
};

export function isAuthenticationAllowed(
  user: AuthenticationCandidate,
): boolean {
  if (user.status !== UserStatus.ACTIVE) {
    return false;
  }

  if (user.role !== UserRole.CLIENT_VIEWER) {
    return true;
  }

  return Boolean(
    user.clientId &&
    user.client &&
    user.client.id === user.clientId &&
    user.client.isActive,
  );
}
