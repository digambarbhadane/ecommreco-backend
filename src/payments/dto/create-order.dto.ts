import { IsMongoId, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePaymentOrderDto {
  @IsMongoId()
  plan_id: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  coupon_code?: string;

  @IsOptional()
  @IsString()
  idempotency_key?: string;

  /** Optional checkout metadata for trial upgrades */
  @IsOptional()
  metadata?: Record<string, unknown>;
}
