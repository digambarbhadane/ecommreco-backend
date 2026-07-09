import { IsIn, IsOptional, IsString } from 'class-validator';

export class StateWiseExportDto {
  @IsString()
  sellerId!: string;

  @IsString()
  gstin!: string;

  /** Single seller-marketplace link id (Mongo _id). */
  @IsOptional()
  @IsString()
  marketplace?: string;

  /** Comma-separated seller-marketplace ids when exporting all registered channels. */
  @IsOptional()
  @IsString()
  marketplaceIds?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';

  /** YYYY-MM — filters import rows for state+SKU reports. */
  @IsOptional()
  @IsString()
  reportMonth?: string;

  /** Group SKU rows by master SKU or marketplace SKU. */
  @IsOptional()
  @IsIn(['master_sku', 'marketplace_sku'])
  skuGrouping?: 'master_sku' | 'marketplace_sku';
}
