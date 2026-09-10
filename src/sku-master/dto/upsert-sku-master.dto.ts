import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { parseSkuRate } from '../sku-rate.util';

export class UpsertSkuMasterDto {
  @IsString()
  @IsNotEmpty()
  gstId: string;

  @IsString()
  @IsNotEmpty()
  marketplace: string;

  @IsString()
  @IsNotEmpty()
  marketplaceSku: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  masterSku: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }
    const parsed = parseSkuRate(value);
    return parsed === null ? undefined : parsed;
  })
  @IsNumber()
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;
}
