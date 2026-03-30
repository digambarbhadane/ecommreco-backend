import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateLeadStatusDto {
  @IsOptional()
  @IsIn(['new', 'contacted', 'interested', 'converted', 'rejected'])
  leadStatus?: 'new' | 'contacted' | 'interested' | 'converted' | 'rejected';

  @IsOptional()
  @IsIn([
    'GENERATED',
    'CONTACTED',
    'CONNECTED',
    'FOLLOW_UP',
    'CONVERTED',
    'LOST',
  ])
  status?:
    | 'GENERATED'
    | 'CONTACTED'
    | 'CONNECTED'
    | 'FOLLOW_UP'
    | 'CONVERTED'
    | 'LOST';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
