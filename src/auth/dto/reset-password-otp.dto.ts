import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordWithOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  confirmPassword!: string;
}

export class ForgotPasswordOtpDto {
  @ApiProperty({ example: '9876543210' })
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number',
  })
  mobile!: string;
}
