import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OTP_PURPOSE_VALUES, type OtpPurpose } from '../otp.constants';

export class SendOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile!: string;

  @ApiProperty({ enum: OTP_PURPOSE_VALUES, example: 'REGISTER' })
  @IsIn(OTP_PURPOSE_VALUES)
  purpose!: OtpPurpose;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile!: string;

  @ApiProperty({ example: '483921', required: false })
  @ValidateIf((dto: VerifyOtpDto) => !dto.accessToken)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp?: string;

  @ApiProperty({
    required: false,
    description: 'MSG91 OTP Widget request id from send OTP response',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'OTP request id is invalid' })
  reqId?: string;

  @ApiProperty({
    required: false,
    description:
      'MSG91 OTP Widget access token (legacy server-side verification)',
  })
  @ValidateIf((dto: VerifyOtpDto) => !dto.otp && !dto.reqId)
  @IsOptional()
  @IsString()
  @MinLength(16, { message: 'Access token is invalid' })
  accessToken?: string;

  @ApiProperty({ enum: OTP_PURPOSE_VALUES, example: 'REGISTER' })
  @IsIn(OTP_PURPOSE_VALUES)
  purpose!: OtpPurpose;
}

export class ResendOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile!: string;

  @ApiProperty({ enum: OTP_PURPOSE_VALUES, example: 'REGISTER' })
  @IsIn(OTP_PURPOSE_VALUES)
  purpose!: OtpPurpose;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
