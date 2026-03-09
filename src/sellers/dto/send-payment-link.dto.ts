import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendPaymentLinkDto {
  @IsOptional()
  @IsIn(['sms', 'whatsapp', 'email'])
  channel?: 'sms' | 'whatsapp' | 'email';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipient?: string;
}
