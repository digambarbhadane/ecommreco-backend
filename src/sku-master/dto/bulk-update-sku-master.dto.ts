import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;
}

export class BulkUpdateSkuMasterDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateSkuMasterItemDto)
  items: BulkUpdateSkuMasterItemDto[];
}
