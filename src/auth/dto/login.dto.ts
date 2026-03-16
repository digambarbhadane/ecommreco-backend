import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : undefined,
  )
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  password: string;
}
