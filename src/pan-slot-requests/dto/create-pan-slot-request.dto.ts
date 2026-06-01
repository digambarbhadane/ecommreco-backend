import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PAN_SLOT_DURATION_TYPES } from '../schemas/pan-slot-request.schema';

export class CreatePanSlotRequestDto {
  @IsInt()
  @Min(1)
  requestedPanSlots: number;

  @IsNotEmpty()
  @IsIn([...PAN_SLOT_DURATION_TYPES])
  durationType: (typeof PAN_SLOT_DURATION_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  remarks?: string;
}
