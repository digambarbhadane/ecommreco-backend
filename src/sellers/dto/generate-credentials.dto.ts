import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GenerateCredentialsDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password?: string;
}
