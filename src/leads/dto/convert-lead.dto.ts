import { IsInt, Min, IsOptional } from 'class-validator';

export class ConvertLeadDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  gstSlots?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationYears?: number;
}
