import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BallotView,
  CastBallotDto,
  CreateVoteDto,
  Vote,
  VoteOutcome,
  VoteThresholdType,
  VoteTally,
} from '@org/shared';
import { environment } from '../../../environments/environment';

export type VoteStatus = 'SCHEDULED' | 'OPEN' | 'CLOSED';

/** Vote row as returned by the building votes list. */
export interface VoteListItem extends Vote {
  status: VoteStatus;
  ballotsCount: number;
}

export interface VoteDetail {
  vote: VoteListItem;
  myBallots: BallotView[];
  tally: VoteTally;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Derives the display status of a vote from its window (pure). */
export function voteStatusOf(
  vote: Pick<Vote, 'opensAt' | 'closesAt'> & { result?: VoteOutcome | null },
  now: Date = new Date(),
): VoteStatus {
  if (vote.result) return 'CLOSED';
  const t = now.getTime();
  if (Date.parse(vote.closesAt) <= t) return 'CLOSED';
  return Date.parse(vote.opensAt) > t ? 'SCHEDULED' : 'OPEN';
}

/** Greek label for a threshold type. */
export function thresholdLabel(thresholdType: VoteThresholdType): string {
  switch (thresholdType) {
    case 'MILLIMES_MAJORITY':
      return 'Πλειοψηφία χιλιοστών';
    case 'HEADCOUNT':
      return 'Μέτρηση κεφαλών (1 ανά διαμέρισμα)';
    default:
      return 'Απλή πλειοψηφία';
  }
}

/** Badge style for a vote status (cls + label). */
export function voteStatusBadge(status: VoteStatus): { cls: string; label: string } {
  switch (status) {
    case 'OPEN':
      return { cls: 'bg-blue-100 text-blue-800', label: 'Ανοιχτή' };
    case 'SCHEDULED':
      return { cls: 'bg-amber-100 text-amber-800', label: 'Προγραμματισμένη' };
    default:
      return { cls: 'bg-slate-200 text-slate-700', label: 'Έκλεισε' };
  }
}

/** Countdown-ish text for closesAt relative to `now` (pure). */
export function closesAtLabel(closesAt: string, now: Date = new Date()): string {
  const diff = Date.parse(closesAt) - now.getTime();
  const days = Math.floor(Math.abs(diff) / DAY_MS);
  const hours = Math.floor((Math.abs(diff) % DAY_MS) / (60 * 60 * 1000));
  const when = new Date(closesAt).toLocaleString('el-GR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const time = hours > 0 ? `${days} ημέρες και ${hours} ώρες` : `${hours} ώρες`;
  if (diff >= 0) {
    return days === 0 && hours === 0
      ? `Λήγει τώρα (${when})`
      : `Λήγει σε ${time} — ${when}`;
  }
  return `Έκλεισε πριν από ${time || 'λίγο'} — ${when}`;
}

@Injectable({ providedIn: 'root' })
export class VotesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}`;

  list(buildingId: string): Observable<VoteListItem[]> {
    return this.http.get<VoteListItem[]>(`${this.base}/buildings/${buildingId}/votes`);
  }

  create(buildingId: string, dto: CreateVoteDto): Observable<Vote> {
    return this.http.post<Vote>(`${this.base}/buildings/${buildingId}/votes`, dto);
  }

  detail(voteId: string): Observable<VoteDetail> {
    return this.http.get<VoteDetail>(`${this.base}/votes/${voteId}`);
  }

  castBallot(voteId: string, dto: CastBallotDto): Observable<BallotView> {
    return this.http.post<BallotView>(`${this.base}/votes/${voteId}/ballots`, dto);
  }

  close(voteId: string): Observable<VoteListItem> {
    return this.http.post<VoteListItem>(`${this.base}/votes/${voteId}/close`, {});
  }

  /** ADMIN only: every ballot cast on the vote. */
  ballots(voteId: string): Observable<BallotView[]> {
    return this.http.get<BallotView[]>(`${this.base}/votes/${voteId}/ballots`);
  }
}
