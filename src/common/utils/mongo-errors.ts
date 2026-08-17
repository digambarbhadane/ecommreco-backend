import { ServiceUnavailableException } from '@nestjs/common';

export function isMongoDisconnectedError(exception: unknown): boolean {
  if (!exception || typeof exception !== 'object') {
    return false;
  }
  const err = exception as { name?: string; message?: string };
  const name = String(err.name ?? '');
  const message = String(err.message ?? '');
  return (
    name === 'MongoNotConnectedError' ||
    name === 'MongoExpiredSessionError' ||
    /Client must be connected/i.test(message) ||
    /buffering timed out/i.test(message) ||
    /ECONNREFUSED|ENOTFOUND|ETIMEOUT|server selection timed out/i.test(
      message,
    )
  );
}

export function isMongoStorageQuotaError(exception: unknown): boolean {
  if (!exception || typeof exception !== 'object') {
    return false;
  }
  const err = exception as {
    code?: number;
    codeName?: string;
    message?: string;
  };
  const message = String(err.message ?? '');
  return (
    err.code === 8000 ||
    err.codeName === 'AtlasError' ||
    /space quota|writes are blocked/i.test(message)
  );
}

const STORAGE_FULL_MESSAGE =
  'Database storage is full. Deletes and other writes are blocked until space is freed. Please contact your administrator or upgrade database storage.';

export function rethrowMongoWriteError(error: unknown): never {
  if (isMongoStorageQuotaError(error)) {
    throw new ServiceUnavailableException({
      success: false,
      errorCode: 'DATABASE_STORAGE_FULL',
      message: STORAGE_FULL_MESSAGE,
    });
  }
  throw error;
}
