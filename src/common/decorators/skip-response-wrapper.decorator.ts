import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_WRAPPER_KEY = 'skipResponseWrapper';

/**
 * Streaming responses such as Server-Sent Events must not be converted to the
 * normal { success, data, timestamp } envelope.
 */
export const SkipResponseWrapper = () =>
  SetMetadata(SKIP_RESPONSE_WRAPPER_KEY, true);
