import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListAnalyticsPayoutsDto {
  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  marketplace?: string;

  @IsOptional()
  @IsString()
  marketplaceSlug?: string;

  @IsOptional()
  @IsString()
  paymentDateFrom?: string;

  @IsOptional()
  @IsString()
  paymentDateTo?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'paymentDate',
    'bankSettlementTotal',
    'bankReceiveDate',
    'bankReceiveAmount',
    'neftId',
    'marketplace',
    'variance',
  ])
  sortBy?:
    | 'paymentDate'
    | 'bankSettlementTotal'
    | 'bankReceiveDate'
    | 'bankReceiveAmount'
    | 'neftId'
    | 'marketplace'
    | 'variance';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  skip?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(['all', 'verified', 'pending'])
  receiptStatus?: 'all' | 'verified' | 'pending';
}
