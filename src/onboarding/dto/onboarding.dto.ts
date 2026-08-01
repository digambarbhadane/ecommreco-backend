import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class OnboardingRegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName!: string;

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
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, { message: 'Invalid PAN number' })
  panNumber!: string;

  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i, {
    message: 'Invalid GST number',
  })
  gstNumber!: string;

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
  country?: string;

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
  source?: string;
}

export class OnboardingResumePaymentDto {
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class OnboardingConfirmPaymentDto {
  @IsString()
  orderId!: string;
}

export class OnboardingConfirmPublicDto {
  @IsString()
  orderId!: string;

  @IsEmail()
  email!: string;
}

export class CreatePaymentLinkDto {
  @IsString()
  leadId!: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsIn(['trial', 'subscription', 'custom'])
  linkType?: 'trial' | 'subscription' | 'custom';

  @IsOptional()
  @IsNumber()
  customAmount?: number;

  @IsOptional()
  @IsNumber()
  expiryHours?: number;
}

export class ContactSalesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class ListOnboardingLeadsQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
