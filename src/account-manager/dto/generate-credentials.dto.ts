import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateCredentialsDto {
  @IsNotEmpty()
  @IsString()
  sellerId: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
