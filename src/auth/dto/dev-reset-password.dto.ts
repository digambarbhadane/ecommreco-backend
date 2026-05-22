import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DevResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : undefined,
  )
  identifier: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;
}
