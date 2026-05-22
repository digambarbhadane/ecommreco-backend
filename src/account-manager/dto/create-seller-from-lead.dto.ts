import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateSellerFromLeadDto {
  @IsNotEmpty()
  @IsString()
  leadId: string;

  @IsNotEmpty()
  @IsString()
  fullName: string;

  @IsNotEmpty()
  @IsString()
  contactNumber: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  gstNumber: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  gstSlots?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationYears?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  verificationNotes?: string;
}
