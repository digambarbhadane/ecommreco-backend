import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const allowedStatuses = ['pending', 'approved', 'rejected', 'blocked'] as const;

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  role?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsIn(allowedStatuses)
  status?: (typeof allowedStatuses)[number];

  @IsOptional()
  @IsBoolean()
  profileCompleted?: boolean;

  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;
}
