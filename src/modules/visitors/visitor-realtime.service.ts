import {
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  Observable,
  Subject,
  defer,
  interval,
  map,
  merge,
  of,
  switchMap,
} from 'rxjs';
import { PrismaService } from '../../database/prisma.service';

type VisitorRealtimeNotification = {
  type: 'VISITORS_CHANGED';
  eventId: string;
  cursor: string;
  changedAt: string;
};

@Injectable()
export class VisitorRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VisitorRealtimeService.name);

  private readonly eventSubjects = new Map<
    string,
    Subject<VisitorRealtimeNotification>
  >();

  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private lastObservedId = 0n;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const aggregate = await this.prisma.visitorChange.aggregate({
      _max: { id: true },
    });

    this.lastObservedId = aggregate._max.id ?? 0n;

    this.pollTimer = setInterval(() => {
      void this.pollJournal();
    }, 500);

    this.pollTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const subject of this.eventSubjects.values()) {
      subject.complete();
    }

    this.eventSubjects.clear();
  }

  streamForStaff(userId: string): Observable<MessageEvent> {
    return defer(async () => {
      const assignment = await this.prisma.staffAssignment.findFirst({
        where: {
          userId,
          isActive: true,
        },
        orderBy: { updatedAt: 'desc' },
        select: { eventId: true },
      });

      if (!assignment) {
        throw new NotFoundException('Active staff assignment not found');
      }

      return {
        eventId: assignment.eventId,
        latestCursor: await this.getLatestCursor(assignment.eventId),
      };
    }).pipe(
      switchMap(({ eventId, latestCursor }) => {
        const subject = this.getEventSubject(eventId);

        const connected$ = of<MessageEvent>({
          type: 'connected',
          id: latestCursor,
          retry: 1500,
          data: {
            type: 'CONNECTED',
            eventId,
            latestCursor,
            connectedAt: new Date().toISOString(),
          },
        });

        const changes$ = subject.pipe(
          map(
            (notification): MessageEvent => ({
              type: 'visitors-changed',
              id: notification.cursor,
              retry: 1500,
              data: notification,
            }),
          ),
        );

        const heartbeat$ = interval(15_000).pipe(
          map(
            (): MessageEvent => ({
              type: 'heartbeat',
              data: {
                type: 'HEARTBEAT',
                eventId,
                sentAt: new Date().toISOString(),
              },
            }),
          ),
        );

        return merge(connected$, changes$, heartbeat$);
      }),
    );
  }

  async getLatestCursor(eventId: string) {
    const aggregate = await this.prisma.visitorChange.aggregate({
      where: { eventId },
      _max: { id: true },
    });

    return (aggregate._max.id ?? 0n).toString();
  }

  private getEventSubject(eventId: string) {
    let subject = this.eventSubjects.get(eventId);

    if (!subject) {
      subject = new Subject<VisitorRealtimeNotification>();
      this.eventSubjects.set(eventId, subject);
    }

    return subject;
  }

  private async pollJournal() {
    if (this.polling) {
      return;
    }

    this.polling = true;

    try {
      while (true) {
        const changes = await this.prisma.visitorChange.findMany({
          where: {
            id: { gt: this.lastObservedId },
          },
          orderBy: { id: 'asc' },
          take: 1000,
          select: {
            id: true,
            eventId: true,
            changedAt: true,
          },
        });

        if (changes.length === 0) {
          break;
        }

        const latestByEvent = new Map<
          string,
          { id: bigint; changedAt: Date }
        >();

        for (const change of changes) {
          this.lastObservedId = change.id;
          latestByEvent.set(change.eventId, {
            id: change.id,
            changedAt: change.changedAt,
          });
        }

        for (const [eventId, latest] of latestByEvent) {
          this.getEventSubject(eventId).next({
            type: 'VISITORS_CHANGED',
            eventId,
            cursor: latest.id.toString(),
            changedAt: latest.changedAt.toISOString(),
          });
        }

        if (changes.length < 1000) {
          break;
        }
      }
    } catch (error) {
      this.logger.error(
        'Visitor realtime journal polling failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.polling = false;
    }
  }
}
