import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyPaymentDto {
  @IsString()
  @IsNotEmpty()
  order_id: string;
}

export class RefundPaymentDto {
  @IsString()
  @IsNotEmpty()
  order_id: string;

  @IsOptional()
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RenewSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  plan_id: string;

  @IsOptional()
  @IsString()
  coupon_code?: string;
}

export class CancelSubscriptionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
