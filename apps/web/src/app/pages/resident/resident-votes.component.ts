import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { EMPTY, catchError, forkJoin, map } from 'rxjs';
import { VoteChoice } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  VoteDetail,
  VoteListItem,
  VotesApiService,
  closesAtLabel,
  thresholdLabel,
  voteStatusBadge,
} from '../../core/api/votes-api.service';
import { ToastService } from '../../ui/toast.service';
import { VoteTallyComponent } from '../../ui/vote-tally.component';
import { AnalyticsService } from '../../core/analytics.service';

/** Latest ballot of the current user for a vote (pure). */
export function myChoice(detail: VoteDetail | undefined): VoteChoice | null {
  const ballots = detail?.myBallots ?? [];
  if (!ballots.length) return null;
  return ballots[ballots.length - 1].choice;
}

const CHOICE_BUTTONS: {
  choice: VoteChoice;
  label: string;
  cls: string;
}[] = [
  { choice: 'YES', label: 'ΘΕΤΙΚΟ', cls: 'bg-green-600 text-white hover:bg-green-500' },
  { choice: 'NO', label: 'ΑΡΝΗΤΙΚΟ', cls: 'bg-red-600 text-white hover:bg-red-500' },
  { choice: 'ABSTAIN', label: 'ΑΠΟΧΗ', cls: 'bg-slate-200 text-slate-700 hover:bg-slate-300' },
];

@Component({
  selector: 'app-resident-votes',
  imports: [VoteTallyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Ψηφοφορίες</h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης ψηφοφοριών.
      </div>
    } @else {
      <div class="grid gap-4 md:grid-cols-2">
        @for (vote of votes(); track vote.id) {
          <div class="card flex flex-col gap-3">
            <div class="flex items-start justify-between gap-2">
              <h2 class="font-semibold text-slate-900">{{ vote.topic }}</h2>
              <span class="badge shrink-0" [class]="statusBadge(vote.status).cls">
                {{ statusBadge(vote.status).label }}
              </span>
            </div>
            @if (vote.description) {
              <p class="text-sm text-slate-600">{{ vote.description }}</p>
            }
            <p class="text-xs text-slate-500">
              {{ thresholdLabel(vote.thresholdType) }} · {{ closesLabel(vote.closesAt) }}
            </p>
            <p class="text-xs text-slate-500">Ψήφοι: {{ vote.ballotsCount }}</p>

            @if (vote.status === 'OPEN') {
              @if (details()[vote.id]; as d) {
                @if (myChoice(d); as chosen) {
                  <p class="text-sm text-green-700">
                    ✓ Έχετε ψηφίσει: {{ choiceLabel(chosen) }} — μπορείτε να αλλάξετε μέχρι το κλείσιμο.
                  </p>
                }
              }
              <div class="grid grid-cols-3 gap-2">
                @for (btn of buttons; track btn.choice) {
                  <button
                    type="button"
                    class="rounded-lg px-2 py-2 text-sm font-semibold transition-colors"
                    [class]="btn.cls"
                    [class.opacity-100]="myChoice(details()[vote.id]) === btn.choice"
                    [class.ring-2.ring-offset-1.ring-slate-900]="
                      myChoice(details()[vote.id]) === btn.choice
                    "
                    [disabled]="votingId() === vote.id"
                    (click)="cast(vote.id, btn.choice)"
                  >
                    {{ btn.label }}
                  </button>
                }
              </div>
            }

            @if (details()[vote.id]; as d) {
              <div class="border-t border-slate-100 pt-3">
                <app-vote-tally [tally]="d.tally" />
              </div>
            }
          </div>
        } @empty {
          <div class="card text-sm text-slate-500 md:col-span-2">
            Δεν υπάρχουν ψηφοφορίες ακόμη.
          </div>
        }
      </div>
    }
  `,
})
export class ResidentVotesPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly votesApi = inject(VotesApiService);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly statusBadge = voteStatusBadge;
  protected readonly thresholdLabel = thresholdLabel;
  protected readonly myChoice = myChoice;

  protected readonly buttons = CHOICE_BUTTONS;

  protected readonly votes = signal<VoteListItem[]>([]);
  protected readonly details = signal<Record<string, VoteDetail>>({});
  protected readonly votingId = signal<string | null>(null);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    this.votesApi
      .list(buildingId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((votes) => {
        this.votes.set(votes);
        this.loading.set(false);
        this.loadDetails(votes.map((v) => v.id));
      });
  }

  private loadDetails(voteIds: string[]): void {
    if (!voteIds.length) return;
    forkJoin(
      voteIds.map((id) =>
        this.votesApi.detail(id).pipe(
          catchError(() => EMPTY),
          map((detail) => [id, detail] as const),
        ),
      ),
    ).subscribe((pairs) => {
      this.details.update((current) => ({
        ...current,
        ...Object.fromEntries(pairs),
      }));
    });
  }

  protected cast(voteId: string, choice: VoteChoice): void {
    if (this.votingId()) return;
    this.votingId.set(voteId);
    this.votesApi
      .castBallot(voteId, { choice })
      .pipe(
        catchError(() => {
          this.toast.error('Η καταχώρηση της ψήφου απέτυχε.');
          this.votingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η ψήφος σας καταχωρήθηκε.');
        this.analytics.capture('vote_cast');
        this.votingId.set(null);
        this.refreshDetail(voteId);
      });
  }

  private refreshDetail(voteId: string): void {
    this.votesApi
      .detail(voteId)
      .pipe(catchError(() => EMPTY))
      .subscribe((detail) => {
        this.details.update((current) => ({ ...current, [voteId]: detail }));
        const votes = this.votes().map((v) =>
          v.id === voteId ? { ...detail.vote } : v,
        );
        this.votes.set(votes);
      });
  }

  protected choiceLabel(choice: VoteChoice): string {
    switch (choice) {
      case 'YES':
        return 'Θετικό';
      case 'NO':
        return 'Αρνητικό';
      default:
        return 'Αποχή';
    }
  }

  protected closesLabel(closesAt: string): string {
    return closesAtLabel(closesAt);
  }
}
