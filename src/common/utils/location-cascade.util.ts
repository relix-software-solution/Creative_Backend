import { Prisma } from '@prisma/client';

type ZoneNode = {
  id: string;
  parentId: string | null;
};

export function collectZoneSubtree(
  zones: ZoneNode[],
  rootIds: string[],
): string[][] {
  const childrenByParent = new Map<string, string[]>();

  for (const zone of zones) {
    if (!zone.parentId) {
      continue;
    }

    const children = childrenByParent.get(zone.parentId) ?? [];
    children.push(zone.id);
    childrenByParent.set(zone.parentId, children);
  }

  const levels: string[][] = [];
  let currentLevel = [...new Set(rootIds)];
  const visited = new Set<string>();

  while (currentLevel.length > 0) {
    const level = currentLevel.filter((id) => !visited.has(id));

    if (level.length === 0) {
      break;
    }

    levels.push(level);
    level.forEach((id) => visited.add(id));
    currentLevel = level.flatMap((id) => childrenByParent.get(id) ?? []);
  }

  return levels;
}

export async function deleteCheckpointDependencies(
  tx: Prisma.TransactionClient,
  checkpointIds: string[],
) {
  if (checkpointIds.length === 0) {
    return;
  }

  const staffSessions = await tx.staffSession.findMany({
    where: { checkpointId: { in: checkpointIds } },
    select: { id: true },
  });
  const staffSessionIds = staffSessions.map(({ id }) => id);
  const syncBatches = await tx.syncBatch.findMany({
    where: {
      OR: [
        { checkpointId: { in: checkpointIds } },
        ...(staffSessionIds.length
          ? [{ staffSessionId: { in: staffSessionIds } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const syncBatchIds = syncBatches.map(({ id }) => id);

  await tx.movementLog.deleteMany({
    where: {
      OR: [
        { checkpointId: { in: checkpointIds } },
        ...(staffSessionIds.length
          ? [{ staffSessionId: { in: staffSessionIds } }]
          : []),
      ],
    },
  });
  await tx.scanEventRaw.deleteMany({
    where: {
      OR: [
        { checkpointId: { in: checkpointIds } },
        ...(staffSessionIds.length
          ? [{ staffSessionId: { in: staffSessionIds } }]
          : []),
      ],
    },
  });

  if (syncBatchIds.length > 0) {
    await tx.syncOperation.deleteMany({
      where: { syncBatchId: { in: syncBatchIds } },
    });
    await tx.syncBatch.deleteMany({ where: { id: { in: syncBatchIds } } });
  }

  if (staffSessionIds.length > 0) {
    await tx.staffSession.deleteMany({
      where: { id: { in: staffSessionIds } },
    });
  }

  await tx.staffAssignment.deleteMany({
    where: { checkpointId: { in: checkpointIds } },
  });
}
