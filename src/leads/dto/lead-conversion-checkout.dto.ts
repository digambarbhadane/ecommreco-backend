import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class LeadConversionQuoteDto {
  @IsMongoId()
  packageId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(MONTH_PATTERN, {
    each: true,
    message: 'Each month must be in YYYY-MM format',
  })
  selectedMonths!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  gstSlots?: number;
}

export class LeadConversionPaymentLinkDto extends LeadConversionQuoteDto {}

export class LeadConversionConfirmPaymentDto {
  @IsString()
  orderId!: string;
}

export class LeadConversionPublicConfirmDto {
  @IsString()
  orderId!: string;
}

export class LeadConversionConfirmByLinkDto {
  @IsString()
  linkId!: string;
}
