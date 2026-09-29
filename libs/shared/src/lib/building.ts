export interface Building {
  id: string;
  name: string;
  address?: string;
  city?: string;
  createdAt?: string;
}

export interface CreateBuildingDto {
  name: string;
  address?: string;
  totalUnits?: number;
}

export const DEFAULT_BUILDING_NAME = 'Untitled Building';

export function createBuilding(id: string, dto: CreateBuildingDto): Building {
  return {
    id,
    name: dto.name || DEFAULT_BUILDING_NAME,
  };
}
