import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyPaymentDto {
  @IsNotEmpty()
  @IsString()
  sellerId: string;

  @IsOptional()
  @IsString()
  verificationNotes?: string;
}
