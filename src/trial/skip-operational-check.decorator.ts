import { SetMetadata } from '@nestjs/common';

export const SKIP_OPERATIONAL_CHECK_KEY = 'skipOperationalCheck';

/** Exempt route from seller subscription operational checks (e.g. payment flows). */
export const SkipOperationalCheck = () =>
  SetMetadata(SKIP_OPERATIONAL_CHECK_KEY, true);
