export interface ProviderSearchFilters {
  trade?: string;
  city?: string;
  minRating?: number;
  q?: string;
}

export interface ProviderDirectoryItemDto {
  userId: string;
  firstName: string;
  lastName: string;
  trade: string;
  certs: string[];
  rating: number | null;
  city: string | null;
  bio: string | null;
  hourlyRateCents: number | null;
  completedJobs: number;
  avgRating: number | null;
  /** ISO end of the provider's ACTIVE featured slot, if featured anywhere. */
  featuredUntil?: string | null;
}

export interface ProviderContactDto {
  phone: string | null;
  email: string;
}

export interface ProviderDetailDto extends ProviderDirectoryItemDto {
  /** Contact details only for ADMIN callers; RESIDENT receives null. */
  contact: ProviderContactDto | null;
}
