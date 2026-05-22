import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const trimOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : undefined;

const phoneRegex = /^\+?[0-9]{7,15}$/;

export class UpdateProfileManagementDto {
  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  profilePhoto?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  employeeId?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trimOrUndefined)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(phoneRegex, { message: 'Phone must be valid' })
  @Transform(trimOrUndefined)
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(phoneRegex, { message: 'Alternate phone must be valid' })
  @Transform(trimOrUndefined)
  alternatePhone?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  gender?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  role?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  department?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  designation?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  reportingManager?: string;

  @IsOptional()
  @IsDateString()
  joiningDate?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  city?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  state?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  country?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  zipCode?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  preferredLanguage?: string;
}
