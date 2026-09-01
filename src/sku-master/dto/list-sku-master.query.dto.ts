import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const STATUS_FILTERS = ['ALL', 'MAPPED', 'UNMAPPED'] as const;

export class ListSkuMasterQueryDto {
  @IsOptional()
  @IsString()
  gstId?: string;

  /** `ALL` or any platform marketplace slug (amazon, flipkart, myntra, …). */
  @IsOptional()
  @IsString()
  marketplace?: string;

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
