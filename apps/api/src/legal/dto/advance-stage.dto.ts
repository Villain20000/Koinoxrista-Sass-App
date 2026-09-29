import { IsIn, IsOptional, IsString } from 'class-validator';
import { LEGAL_STAGES } from '@org/shared';

export class AdvanceStageDto {
  @IsOptional()
  @IsString()
  @IsIn(LEGAL_STAGES as readonly string[])
  nextStage?: string;

  @IsOptional()
  @IsString()
  @IsIn(LEGAL_STAGES as readonly string[])
  stage?: string;
}
