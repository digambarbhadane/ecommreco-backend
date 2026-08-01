import { IsString } from 'class-validator';

export class DeleteMarketplaceDto {
  @IsString()
  gstNumber!: string;

  @IsString()
  confirmation!: string;
}
