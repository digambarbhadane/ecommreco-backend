import { Transform } from 'class-transformer';
import { IsString, Matches, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : '';

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export class ChangePasswordDto {
  @IsString()
  @Transform(trim)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @Matches(passwordRegex, {
    message:
      'Password must include uppercase, lowercase, number, and special character',
  })
  @Transform(trim)
  newPassword: string;
}
