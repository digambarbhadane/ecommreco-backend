import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const toOptionalTrimmedString = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const next = value.trim();
    return next.length ? next : undefined;
  }
  if (typeof value === 'number') {
    const next = String(value).trim();
    return next.length ? next : undefined;
  }
  return undefined;
};

const toOptionalLowerEmail = (value: unknown) => {
  const next = toOptionalTrimmedString(value);
  return typeof next === 'string' ? next.toLowerCase() : undefined;
};

const toOptionalUpper = (value: unknown) => {
  const next = toOptionalTrimmedString(value);
  return typeof next === 'string' ? next.toUpperCase() : undefined;
};

export class ImportLeadRowDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => toOptionalTrimmedString(value))
  fullName?: string;

  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) => {
    const next = String(value ?? '')
      .trim()
      .replace(/\D/g, '');
    return next;
  })
  @Matches(/^\d{10}$/, {
    message: 'contactNumber must be exactly 10 digits',
  })
  contactNumber: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => toOptionalLowerEmail(value))
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => toOptionalUpper(value))
  @MaxLength(16)
  @MinLength(16)
  @Matches(/^[A-Za-z0-9]{16}$/, {
    message: 'gstNumber must be 16 alphanumeric characters',
  })
  gstNumber?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => toOptionalTrimmedString(value))
  source?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => toOptionalTrimmedString(value))
  assignedSalesManagerId?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => toOptionalLowerEmail(value))
  assignedSalesManagerEmail?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class ImportLeadsDto {
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportLeadRowDto)
  leads: ImportLeadRowDto[];

  @IsOptional()
  @IsIn(['auto', 'specific', 'round_robin_selected', 'random_selected'])
  assignmentMode?:
    | 'auto'
    | 'specific'
    | 'round_robin_selected'
    | 'random_selected';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  salesManagerIds?: string[];
}
