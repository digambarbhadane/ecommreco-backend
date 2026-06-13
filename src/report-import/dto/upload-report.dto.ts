import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

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

  /** Calendar month for month-wise imports (YYYY-MM). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'reportMonth must be in YYYY-MM format',
  })
  reportMonth?: string;
}
