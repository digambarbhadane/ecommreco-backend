import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateSkuMasterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  masterSku: string;
}
