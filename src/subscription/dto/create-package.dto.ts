import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const discountTypes = ['percentage', 'flat', 'none'] as const;
export type DiscountType = (typeof discountTypes)[number];

export class CreateSubscriptionPackageDto {
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  name: string;

  @IsNumber()
  @Min(0)
  basePrice: number;

  @IsIn(discountTypes)
  discountType: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountValue?: number;

  @IsNumber()
  @Min(1)
  durationInDays: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
