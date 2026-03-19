import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, {
    message: 'contactNumber must be exactly 10 digits',
  })
  contactNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  gstNumber?: string;

  @IsOptional()
  @IsString()
  firmName?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
