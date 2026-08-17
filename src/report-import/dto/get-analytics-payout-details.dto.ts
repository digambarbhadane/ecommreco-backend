import { IsOptional, IsString } from 'class-validator';

export class GetAnalyticsPayoutDetailsDto {
  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  marketplace?: string;

  @IsOptional()
  @IsString()
  neftId?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  paymentDate?: string;
}
