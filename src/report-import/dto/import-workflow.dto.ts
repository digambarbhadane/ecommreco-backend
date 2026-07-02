import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class MarketplaceRefDto {
  @IsString()
  @IsNotEmpty()
  marketplaceId: string;

  @IsString()
  @IsIn(['flipkart', 'amazon', 'meesho', 'myntra'])
  marketplaceKey: 'flipkart' | 'amazon' | 'meesho' | 'myntra';
}

export class WorkflowStatusDto {
  @IsString()
  @IsNotEmpty()
  sellerId: string;

  @IsString()
  @IsNotEmpty()
  gstId: string;

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  reportMonth: string;

  @IsOptional()
  @IsString()
  marketplaceId?: string;

  @IsOptional()
  @IsIn(['flipkart', 'amazon', 'meesho', 'myntra'])
  marketplace?: 'flipkart' | 'amazon' | 'meesho' | 'myntra';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MarketplaceRefDto)
  marketplaces?: MarketplaceRefDto[];
}

export class DeleteSlotDto {
  @IsString()
  @IsNotEmpty()
  sellerId: string;

  @IsString()
  @IsNotEmpty()
  gstId: string;

  @IsString()
  @IsNotEmpty()
  marketplaceId: string;

  @IsIn(['flipkart', 'amazon', 'meesho', 'myntra'])
  marketplace: 'flipkart' | 'amazon' | 'meesho' | 'myntra';

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  reportMonth: string;

  @IsString()
  @IsNotEmpty()
  slot: string;
}
