import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpsertEligibilityRuleDto {
  @IsIn(['GENERAL', 'STRUCTURAL', 'FINANCIAL'])
  category!: 'GENERAL' | 'STRUCTURAL' | 'FINANCIAL';

  @IsArray()
  @IsIn(['OWNER', 'TENANT'], { each: true })
  @IsString({ each: true })
  allowedTypes!: ('OWNER' | 'TENANT')[];

  @IsOptional()
  @IsBoolean()
  requiresMillimes?: boolean;
}
