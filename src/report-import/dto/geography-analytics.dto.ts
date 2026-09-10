import { IsIn, IsOptional, IsString } from 'class-validator';

export const GEOGRAPHY_METRICS = [
  'sales',
  'orders',
  'units',
  'netSales',
  'profit',
  'aov',
  'returnValue',
  'returnRate',
] as const;

export type GeographyMetric = (typeof GEOGRAPHY_METRICS)[number];

export class GeographyAnalyticsDto {
  @IsString()
  sellerId!: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  marketplace?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsString()
  @IsIn([...GEOGRAPHY_METRICS])
  metric?: GeographyMetric;

  @IsOptional()
  @IsString()
  stateCode?: string;

  @IsOptional()
  @IsString()
  @IsIn(['csv', 'xlsx'])
  format?: 'csv' | 'xlsx';
}
