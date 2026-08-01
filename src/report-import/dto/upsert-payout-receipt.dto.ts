import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpsertPayoutReceiptDto {
  @IsString()
  sellerId: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsString()
  marketplace: string;

  @IsString()
  neftId: string;

  @IsOptional()
  @IsString()
  paymentDate?: string;

  @IsOptional()
  @IsNumber()
  bankSettlementTotal?: number;

  @IsOptional()
  @IsString()
  bankReceiveDate?: string;

  @IsOptional()
  @IsNumber()
  bankReceiveAmount?: number;
}
