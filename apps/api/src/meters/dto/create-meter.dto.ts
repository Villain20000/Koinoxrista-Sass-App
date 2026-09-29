import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const METER_KINDS = ['WATER', 'HEAT'] as const;

export class CreateMeterDto {
  @IsString()
  unitId!: string;

  @IsIn(METER_KINDS)
  kind!: (typeof METER_KINDS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
