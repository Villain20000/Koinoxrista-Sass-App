import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Bid,
  BidStatus,
  CreateBidDto,
  CreateJobDto,
  CreateWorkLogDto,
  Job,
  JobStatus,
  WorkLogView,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** Job row for admins, including its bids. */
export interface JobWithBids extends Job {
  bids?: Bid[];
}

/** Provider profile (GET/PUT /provider/profile). */
export interface ProviderProfile {
  trade: string | null;
  certs: string[];
  ratingStars?: number | null;
  ratingCount?: number | null;
}

/** Badge style for a job status (cls + label). */
export function jobStatusBadge(status: JobStatus): { cls: string; label: string } {
  switch (status) {
    case 'OPEN':
      return { cls: 'bg-blue-100 text-blue-800', label: 'Ανοιχτή' };
    case 'AWARDED':
      return { cls: 'bg-amber-100 text-amber-800', label: 'Ανατέθηκε' };
    case 'IN_PROGRESS':
      return { cls: 'bg-indigo-100 text-indigo-700', label: 'Σε εξέλιξη' };
    case 'COMPLETED':
      return { cls: 'bg-green-100 text-green-800', label: 'Ολοκληρώθηκε' };
    default:
      return { cls: 'bg-slate-200 text-slate-600', label: 'Ακυρώθηκε' };
  }
}

/** Badge style for a bid status. */
export function bidStatusBadge(status: BidStatus): { cls: string; label: string } {
  switch (status) {
    case 'ACCEPTED':
      return { cls: 'bg-green-100 text-green-800', label: 'Εγκεκριμένη' };
    case 'REJECTED':
      return { cls: 'bg-red-100 text-red-700', label: 'Απορρίφθηκε' };
    default:
      return { cls: 'bg-slate-200 text-slate-700', label: 'Υπό εξέταση' };
  }
}

@Injectable({ providedIn: 'root' })
export class JobsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}`;

  listForBuilding(buildingId: string): Observable<JobWithBids[]> {
    return this.http.get<JobWithBids[]>(
      `${this.base}/buildings/${buildingId}/jobs`,
    );
  }

  create(buildingId: string, dto: CreateJobDto): Observable<Job> {
    return this.http.post<Job>(`${this.base}/buildings/${buildingId}/jobs`, dto);
  }

  /** PROVIDER: jobs open for bidding. */
  marketplace(): Observable<JobWithBids[]> {
    return this.http.get<JobWithBids[]>(`${this.base}/jobs/marketplace`);
  }

  /** PROVIDER: jobs awarded to / executed by the current provider. */
  mine(): Observable<JobWithBids[]> {
    return this.http.get<JobWithBids[]>(`${this.base}/jobs/mine`);
  }

  createBid(jobId: string, dto: CreateBidDto): Observable<Bid> {
    return this.http.post<Bid>(`${this.base}/jobs/${jobId}/bids`, dto);
  }

  acceptBid(bidId: string): Observable<Bid> {
    return this.http.post<Bid>(`${this.base}/bids/${bidId}/accept`, {});
  }

  rejectBid(bidId: string): Observable<Bid> {
    return this.http.post<Bid>(`${this.base}/bids/${bidId}/reject`, {});
  }

  addWorkLog(jobId: string, dto: CreateWorkLogDto): Observable<WorkLogView> {
    return this.http.post<WorkLogView>(`${this.base}/jobs/${jobId}/work-logs`, dto);
  }

  workLogs(jobId: string): Observable<WorkLogView[]> {
    return this.http.get<WorkLogView[]>(`${this.base}/jobs/${jobId}/work-logs`);
  }

  complete(jobId: string): Observable<Job> {
    return this.http.post<Job>(`${this.base}/jobs/${jobId}/complete`, {});
  }

  rate(jobId: string, stars: number): Observable<Job> {
    return this.http.post<Job>(`${this.base}/jobs/${jobId}/rating`, { stars });
  }

  /** RESIDENT: report a defect for a building. */
  createDefect(buildingId: string, dto: CreateJobDto): Observable<Job> {
    return this.http.post<Job>(
      `${this.base}/buildings/${buildingId}/defects`,
      dto,
    );
  }
}

@Injectable({ providedIn: 'root' })
export class ProviderProfileApiService {
  private readonly http = inject(HttpClient);

  get(): Observable<ProviderProfile> {
    return this.http.get<ProviderProfile>(
      `${environment.apiUrl}/provider/profile`,
    );
  }

  update(profile: Pick<ProviderProfile, 'trade' | 'certs'>): Observable<ProviderProfile> {
    return this.http.put<ProviderProfile>(
      `${environment.apiUrl}/provider/profile`,
      profile,
    );
  }
}
