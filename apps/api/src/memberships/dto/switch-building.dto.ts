import { IsString, MinLength } from 'class-validator';

/** Body of POST /auth/switch-building (mirrors @org/shared SwitchBuildingDto). */
export class SwitchBuildingDto {
  @IsString()
  @MinLength(1)
  buildingId!: string;
}
