import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;
}
