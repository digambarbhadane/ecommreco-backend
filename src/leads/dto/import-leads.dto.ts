import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateManualLeadDto } from './create-manual-lead.dto';

export class ImportLeadRowDto extends CreateManualLeadDto {}

export class ImportLeadsDto {
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportLeadRowDto)
  leads: ImportLeadRowDto[];

  @IsOptional()
  @IsIn(['auto', 'specific', 'round_robin_selected', 'random_selected'])
  assignmentMode?:
    | 'auto'
    | 'specific'
    | 'round_robin_selected'
    | 'random_selected';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  salesManagerIds?: string[];
}
