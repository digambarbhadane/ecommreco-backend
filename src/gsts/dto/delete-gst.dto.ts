import { IsString } from 'class-validator';

export class DeleteGstDto {
  @IsString()
  gstNumber!: string;

  @IsString()
  confirmation!: string;
}
