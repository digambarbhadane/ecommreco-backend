import { IsNotEmpty, IsString } from 'class-validator';

export class UploadReportDto {
  @IsString()
  @IsNotEmpty()
  sellerId: string;

  @IsString()
  @IsNotEmpty()
  gstId: string;

  @IsString()
  @IsNotEmpty()
  marketplaceId: string;
}
