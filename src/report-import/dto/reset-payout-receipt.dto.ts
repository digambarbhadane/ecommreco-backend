import { IsOptional, IsString } from 'class-validator';

export class ResetPayoutReceiptDto {
  @IsString()
  sellerId: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsString()
  marketplace: string;

  @IsString()
  neftId: string;
}
