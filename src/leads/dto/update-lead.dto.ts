import {
  IsArray,
  IsEmail,
  IsInt,
  Min,
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
  @IsArray()
  @IsString({ each: true })
  gstNumbers?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  gstCount?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  marketplaces?: string[];

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
