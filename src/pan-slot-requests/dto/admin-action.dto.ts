import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class AdminRemarksDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  adminRemarks?: string;
}

export class VerifyPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  adminRemarks?: string;
}

export class PaymentProofDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  paymentProof?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentReference?: string;
}

export class UpdatePricingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerSlot?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
