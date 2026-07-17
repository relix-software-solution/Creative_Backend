import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

interface ErrorResponseBody {
  success: false;
  message: string | string[];
  statusCode: number;
  timestamp: string;
  path: string;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter<HttpException> {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const message = this.resolveMessage(exceptionResponse, exception);

    response.status(statusCode).send({
      success: false,
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
    } satisfies ErrorResponseBody);
  }

  private resolveMessage(
    exceptionResponse: string | object,
    exception: HttpException,
  ): string | string[] {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (
      'message' in exceptionResponse &&
      (typeof exceptionResponse.message === 'string' ||
        Array.isArray(exceptionResponse.message))
    ) {
      return exceptionResponse.message;
    }

    return exception.message;
  }
}
