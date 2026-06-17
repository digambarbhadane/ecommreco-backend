import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/** Reject invalid Mongo ids before findById (avoids CastError → HTTP 500). */
export function parseObjectId(id: string, label: string): Types.ObjectId {
  const value = String(id ?? '').trim();
  if (!Types.ObjectId.isValid(value)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return new Types.ObjectId(value);
}
