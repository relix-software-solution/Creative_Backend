import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();

    return request.device;
  },
);
