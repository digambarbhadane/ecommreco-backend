import { Transform } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { GSTIN_REGEX } from '../gst-verification.constants';

export class CreateGstDto {
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  sellerId: string;

  @IsNotEmpty()
  @IsMongoId({ message: 'A verified GST record is required before saving.' })
  verificationId: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : undefined,
  )
  @Matches(GSTIN_REGEX, { message: 'Please enter a valid GST number.' })
  gstNumber?: string;
}
