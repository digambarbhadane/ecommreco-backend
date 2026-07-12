import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const MARKETPLACE_FILTERS = [
  'ALL',
  'myntra',
  'meesho',
  'amazon',
  'flipkart',
] as const;

const STATUS_FILTERS = ['ALL', 'MAPPED', 'UNMAPPED'] as const;

export class ExportSkuMasterQueryDto {
  @IsString()
  @IsNotEmpty()
  gstId: string;

  @IsOptional()
  @IsIn(MARKETPLACE_FILTERS)
  marketplace?: (typeof MARKETPLACE_FILTERS)[number];

  @IsOptional()
  @IsIn(STATUS_FILTERS)
  status?: (typeof STATUS_FILTERS)[number];

  @IsOptional()
  @IsString()
  search?: string;
}
