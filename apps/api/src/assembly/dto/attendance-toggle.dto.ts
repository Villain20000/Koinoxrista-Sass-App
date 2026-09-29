import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AttendanceToggleDto {
  @IsString()
  unitId!: string;

  @IsBoolean()
  present!: boolean;

  /** Set when the unit is represented by another unit's owner (εκπρόσωπος). */
  @IsOptional()
  @IsString()
  proxyUnitId?: string | null;
}
