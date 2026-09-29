import { IsDefined, IsObject } from 'class-validator';

/** Body of `POST /transfer/import`; deep shape checks live in the service. */
export class ImportBuildingDto {
  @IsDefined()
  @IsObject()
  payload!: Record<string, unknown>;
}
