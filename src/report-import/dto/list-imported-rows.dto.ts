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

  @IsOptional()
  @IsString()
  @IsIn(['documentType', 'invoiceDate', 'gstin', 'invoiceAmount', 'taxableAmount'])
  sortBy?:
    | 'documentType'
    | 'invoiceDate'
    | 'gstin'
    | 'invoiceAmount'
    | 'taxableAmount';

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
}
