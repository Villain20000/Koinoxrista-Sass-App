export type AssetCategory =
  | 'ELEVATOR'
  | 'BOILER'
  | 'FIRE_EXT'
  | 'PUMP'
  | 'ROOF'
  | 'OTHER';

export const MAINTENANCE_ASSET_CATEGORIES: AssetCategory[] = [
  'ELEVATOR',
  'BOILER',
  'FIRE_EXT',
  'PUMP',
  'ROOF',
  'OTHER',
];

export interface BuildingAssetDto {
  id: string;
  buildingId: string;
  name: string;
  category: AssetCategory;
  location?: string | null;
  installedAt?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface CreateAssetDto {
  name: string;
  category: AssetCategory;
  location?: string;
  installedAt?: string;
  notes?: string;
}

export interface UpdateAssetDto {
  name?: string;
  category?: AssetCategory;
  location?: string;
  installedAt?: string | null;
  notes?: string;
}

export interface MaintenanceScheduleDto {
  id: string;
  assetId: string;
  buildingId: string;
  title: string;
  intervalMonths: number;
  lastDoneAt: string | null;
  nextDueAt: string;
  autoCreateJob: boolean;
  expenseCategoryId?: string | null;
  asset?: { id: string; name: string; category: AssetCategory } | null;
  daysLeft: number;
  status: 'overdue' | 'urgent' | 'upcoming';
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleDto {
  assetId: string;
  title: string;
  intervalMonths: number;
  lastDoneAt?: string;
  autoCreateJob?: boolean;
  expenseCategoryId?: string;
}

export interface UpdateScheduleDto {
  assetId?: string;
  title?: string;
  intervalMonths?: number;
  lastDoneAt?: string | null;
  autoCreateJob?: boolean;
  expenseCategoryId?: string | null;
}

export interface MarkDoneDto {
  notes?: string;
}

export interface GenerateJobsResultDto {
  created: number;
  skipped: number;
}

export interface CalendarEventDto {
  id: string;
  title: string;
  assetId: string;
  assetName: string | null;
  category: AssetCategory | null;
  dueAt: string;
  lastDoneAt: string | null;
  intervalMonths: number;
  daysLeft: number;
  status: 'overdue' | 'urgent' | 'upcoming';
  autoCreateJob: boolean;
}

export interface CalendarResponseDto {
  from: string;
  to: string;
  assets: BuildingAssetDto[];
  schedules: MaintenanceScheduleDto[];
  events: CalendarEventDto[];
}
