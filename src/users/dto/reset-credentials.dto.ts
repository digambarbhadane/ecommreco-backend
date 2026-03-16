import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResetCredentialsDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
