import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class AssignSubscriptionDto {
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  leadId: string;

  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  packageId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  customDuration?: number;
}
