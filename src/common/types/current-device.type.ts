import { DeviceStatus } from '@prisma/client';

export type CurrentDevice = {
  id: string;
  eventId: string;
  name: string;
  code: string;
  status: DeviceStatus;
  lastSeenAt: Date | null;
  metadata: unknown;
};
