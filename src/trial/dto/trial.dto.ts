import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterTrialDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerName!: string;

  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i, {
    message: 'Invalid GST number',
  })
  gstNumber!: string;

  @IsString()
  @MinLength(1)
  verificationId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  confirmPassword!: string;

  @IsBoolean()
  acceptTerms!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, { message: 'Invalid PAN number' })
  panNumber?: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  otp?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  emailVerificationId?: string;
}

export class SendTrialOtpDto {
  @IsIn(['email', 'mobile'])
  channel!: 'email' | 'mobile';

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string;
}

export class VerifyTrialOtpDto {
  @IsIn(['email', 'mobile'])
  channel!: 'email' | 'mobile';

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile?: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp!: string;
}

export class VerifyTrialGstDto {
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i, {
    message: 'Invalid GST number',
  })
  gstNumber!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, { message: 'Invalid PAN number' })
  panNumber?: string;
}

export class ConfirmTrialPaymentDto {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class GstCheckoutSelectionDto {
  @IsString()
  gstNumber!: string;

  @IsString()
  verificationId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  marketplacePlatformIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedMonths?: string[];
}

export class PurchaseTrialSubscriptionDto {
  /** Optional for single_gst (built-in ₹999 plan). Required for multi_gst_pan. */
  @IsOptional()
  @IsString()
  packageId?: string;

  /** Legacy checkout mode. Optional when gstSelections is provided. */
  @ValidateIf((dto) => !dto.gstSelections?.length)
  @IsIn(['single_gst', 'multi_gst_pan', 'single_gst_multi_marketplace'])
  billingMode?: 'single_gst' | 'multi_gst_pan' | 'single_gst_multi_marketplace';

  /** YYYY-MM months — optional when each marketplace has selectedMonths in gstSelections */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedMonths?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gstNumbers?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, { message: 'Invalid PAN number' })
  panNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  gstSlots?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  panSlots?: number;

  @IsOptional()
  marketplaceSlots?: number;

  @IsOptional()
  @IsString()
  customDurationDays?: string;

  /** Verified GST + marketplace mapping for the redesigned checkout wizard. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GstCheckoutSelectionDto)
  gstSelections?: GstCheckoutSelectionDto[];
}

export class ConfirmSubscriptionPurchaseDto {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class AdminTrialActionDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  extendDays?: number;
}

export class ListTrialsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @IsOptional()
  @IsString()
  converted?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
