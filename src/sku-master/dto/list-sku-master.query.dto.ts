import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const MARKETPLACE_FILTERS = [
  'ALL',
  'myntra',
  'meesho',
  'amazon',
  'flipkart',
] as const;

const STATUS_FILTERS = ['ALL', 'MAPPED', 'UNMAPPED'] as const;

export class ListSkuMasterQueryDto {
  @IsOptional()
  @IsString()
  gstId?: string;

  @IsOptional()
  @IsIn(MARKETPLACE_FILTERS)
  marketplace?: (typeof MARKETPLACE_FILTERS)[number];

  @IsOptional()
  @IsIn(STATUS_FILTERS)
  status?: (typeof STATUS_FILTERS)[number];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
