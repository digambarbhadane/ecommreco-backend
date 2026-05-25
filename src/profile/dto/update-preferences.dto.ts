import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const trimOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : undefined;

export class UpdatePreferencesDto {
  @IsOptional()
  @IsIn(['light', 'dark'])
  theme?: 'light' | 'dark';

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  language?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  dateFormat?: string;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  timeFormat?: string;

  @IsOptional()
  @IsBoolean()
  notificationEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  notificationSms?: boolean;

  @IsOptional()
  @IsBoolean()
  notificationInApp?: boolean;

  @IsOptional()
  @IsBoolean()
  notificationPush?: boolean;

  @IsOptional()
  @IsBoolean()
  eventSellerApproved?: boolean;

  @IsOptional()
  @IsBoolean()
  eventSupportTicketAssigned?: boolean;

  @IsOptional()
  @IsBoolean()
  eventSystemAlerts?: boolean;

  @IsOptional()
  @IsString()
  @Transform(trimOrUndefined)
  dashboardLayout?: string;
}
