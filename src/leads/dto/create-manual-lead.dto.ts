import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateManualLeadDto {
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

  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : undefined,
  )
  @MaxLength(16)
  @MinLength(16)
  @Matches(/^[A-Za-z0-9]{16}$/, {
    message: 'gstNumber must be 16 alphanumeric characters',
  })
  gstNumber: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  assignedSalesManagerId?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : undefined,
  )
  assignedSalesManagerEmail?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
