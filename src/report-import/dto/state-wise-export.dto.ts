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
}
