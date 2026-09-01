import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListAnalyticsPaymentsDto {
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

  /** Filter by invoice date (order context). */
  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

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
    'paymentDate',
    'finalSettlementAmount',
    'transactionId',
    'orderID',
    'invoiceDate',
    'paymentMode',
    'bankSettlementValue',
    'neftId',
    'orderId',
    'saleAmount',
    'marketplaceFee',
    'commission',
    'sellerSku',
    'refund',
    'netSales',
    'difference',
  ])
  sortBy?:
    | 'paymentDate'
    | 'finalSettlementAmount'
    | 'transactionId'
    | 'orderID'
    | 'invoiceDate'
    | 'paymentMode'
    | 'bankSettlementValue'
    | 'neftId'
    | 'orderId'
    | 'saleAmount'
    | 'marketplaceFee'
    | 'commission'
    | 'sellerSku'
    | 'refund'
    | 'netSales'
    | 'difference';

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
  @IsIn(['due', 'overdue', 'settled', 'dispute'])
  paymentStatus?: 'due' | 'overdue' | 'settled' | 'dispute';

  /** Exact Order ID — returns every payment/settlement row for that order. */
  @IsOptional()
  @IsString()
  orderId?: string;
}
