import { Type, Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { parseSkuRate } from '../sku-rate.util';

function toOptionalRate({ value }: { value: unknown }) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }
  const parsed = parseSkuRate(value);
  return parsed === null ? undefined : parsed;
}

export class BulkUpdateSkuMasterItemDto {
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
  @Transform(toOptionalRate)
  @IsNumber()
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;
}

export class BulkUpdateSkuMasterDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateSkuMasterItemDto)
  items: BulkUpdateSkuMasterItemDto[];
}
