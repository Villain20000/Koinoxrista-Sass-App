export type JobStatus = 'OPEN' | 'AWARDED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type BidStatus = 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';

export type JobSource = 'ADMIN_RFP' | 'RESIDENT_REPORT';

export interface Job {
  id: string;
  buildingId: string;
  buildingName?: string;
  title: string;
  description: string;
  status: JobStatus;
  source?: JobSource;
  reporterName?: string | null;
  budgetCents?: number | null;
  createdAt?: string;
}

export interface CreateJobDto {
  title: string;
  description: string;
  budgetCents?: number;
}

/** Resident defect report: title >= 3 chars, description >= 10 chars. */
export interface CreateDefectDto {
  title: string;
  description: string;
}

export interface Bid {
  id: string;
  jobId: string;
  providerUserId: string;
  providerName?: string;
  providerTrade?: string;
  amountCents: number;
  message?: string | null;
  status: BidStatus;
  ratingStars?: number | null;
}

export interface CreateBidDto {
  amountCents: number;
  message?: string;
}

export interface WorkLogView {
  id: string;
  jobId: string;
  note: string;
  loggedAt: string;
}

export interface CreateWorkLogDto {
  note: string;
}
