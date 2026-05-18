import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateLeadDto {
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  fullName: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, {
    message: 'contactNumber must be exactly 10 digits',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  contactNumber: string;

  @IsNotEmpty()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : undefined,
  )
  email: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0
      ? value.trim().toUpperCase()
      : undefined,
  )
  @MaxLength(16)
  @MinLength(16)
  @Matches(/^[A-Za-z0-9]{16}$/, {
    message: 'gstNumber must be 16 alphanumeric characters',
  })
  gstNumber?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (!Array.isArray(value)) return undefined;
    return value
      .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
      .filter((item) => item.length > 0);
  })
  marketplaces: string[];

  @IsNotEmpty()
  @IsString()
  @IsIn(['0-1000', '1000-2000', '2000-3000', '3000+'])
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  ordersPerMonth: '0-1000' | '1000-2000' | '2000-3000' | '3000+';

  @IsIn([true], {
    message: 'You must accept the Terms and Conditions and Privacy Policy',
  })
  @Transform(({ value }): unknown => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  termsAccepted: boolean;

  @IsOptional()
  @IsString()
  source?: string;
}
