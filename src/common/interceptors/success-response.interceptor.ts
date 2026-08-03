import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { SKIP_RESPONSE_WRAPPER_KEY } from '../decorators/skip-response-wrapper.decorator';

interface SuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

@Injectable()
export class SuccessResponseInterceptor<T>
  implements NestInterceptor<T, SuccessResponse<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<T> | T> {
    const skipWrapper = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_WRAPPER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipWrapper) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
