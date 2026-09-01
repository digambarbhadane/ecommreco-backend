import { IsOptional, IsString } from 'class-validator';

export class DeleteMarketplaceDto {
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @IsOptional()
  @IsString()
  confirmation?: string;
}
