import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { GSTIN_REGEX } from '../gst-verification.constants';

export class VerifyGstDto {
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(GSTIN_REGEX, { message: 'Please enter a valid GST number.' })
  gstNumber: string;
}
