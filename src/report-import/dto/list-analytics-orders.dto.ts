import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListAnalyticsOrdersDto {
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
  documentType?: string;

  @IsOptional()
  @IsString()
  documentTypes?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'documentType',
    'invoiceDate',
    'orderCancelDate',
    'frRefundedDate',
    'gstin',
    'invoiceAmount',
    'taxableAmount',
    'orderID',
    'stateName',
    'skuID',
    'quantity',
    'igstAmount',
    'cgstAmount',
    'sgstAmount',
    'marketplace',
  ])
  sortBy?:
    | 'documentType'
    | 'invoiceDate'
    | 'orderCancelDate'
    | 'frRefundedDate'
    | 'gstin'
    | 'invoiceAmount'
    | 'taxableAmount'
    | 'orderID'
    | 'stateName'
    | 'skuID'
    | 'quantity'
    | 'igstAmount'
    | 'cgstAmount'
    | 'sgstAmount'
    | 'marketplace';

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
}
