import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const allowedStatuses = ['pending', 'approved', 'rejected', 'blocked'] as const;

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  role: string;

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
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsIn(allowedStatuses)
  status?: (typeof allowedStatuses)[number];

  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;
}
