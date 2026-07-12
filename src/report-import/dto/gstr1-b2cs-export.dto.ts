import { IsOptional, IsString } from 'class-validator';

export class Gstr1B2csExportDto {
  @IsString()
  sellerId!: string;

  @IsString()
  gstin!: string;

  @IsString()
  reportMonth!: string;

  @IsOptional()
  @IsString()
  marketplace?: string;
}

