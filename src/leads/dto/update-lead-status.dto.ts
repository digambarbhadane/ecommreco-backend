import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateLeadStatusDto {
  @IsIn(['new', 'contacted', 'interested', 'converted', 'rejected'])
  leadStatus: 'new' | 'contacted' | 'interested' | 'converted' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
