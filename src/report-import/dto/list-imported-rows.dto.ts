import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListImportedRowsDto {
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
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  /** Filter rows with settlement/payment enrichment (Flipkart, Meesho) or payment mode. */
  @IsOptional()
  @IsString()
  @IsIn(['yes', 'no'])
  hasPaymentData?: 'yes' | 'no';

  @IsOptional()
  @IsString()
  paymentDateFrom?: string;

  @IsOptional()
  @IsString()
  paymentDateTo?: string;

  @IsOptional()
  @IsString()
  paymentMode?: string;

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
    'paymentDate',
    'finalSettlementAmount',
    'orderID',
  ])
  sortBy?:
    | 'documentType'
    | 'invoiceDate'
    | 'orderCancelDate'
    | 'frRefundedDate'
    | 'gstin'
    | 'invoiceAmount'
    | 'taxableAmount'
    | 'paymentDate'
    | 'finalSettlementAmount'
    | 'orderID';

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
