import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import { CreateVoteDto, VoteThresholdType } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { RealtimeService } from '../../core/realtime.service';
import {
  VoteDetail,
  VoteListItem,
  VotesApiService,
  closesAtLabel,
  thresholdLabel,
  voteStatusBadge,
} from '../../core/api/votes-api.service';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import { ToastService } from '../../ui/toast.service';
import { VoteTallyComponent } from '../../ui/vote-tally.component';

/** Builds a CreateVoteDto from raw form values; returns null when invalid (pure). */
export function buildCreateVoteDto(value: {
  topic: string;
  description: string;
  thresholdType: VoteThresholdType;
  opensAt: string;
  closesAt: string;
}): CreateVoteDto | null {
  const topic = value.topic.trim();
  if (!topic) return null;
  const closes = Date.parse(value.closesAt);
  if (!Number.isFinite(closes)) return null;
  const dto: CreateVoteDto = {
    topic,
    thresholdType: value.thresholdType,
    closesAt: new Date(closes).toISOString(),
  };
  if (value.description.trim()) dto.description = value.description.trim();
  if (value.opensAt) {
    const opens = Date.parse(value.opensAt);
    if (!Number.isFinite(opens)) return null;
    dto.opensAt = new Date(opens).toISOString();
  }
  return dto;
}

@Component({
  selector: 'app-admin-votes',
  imports: [ReactiveFormsModule, ConfirmModalComponent, VoteTallyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold text-slate-900">Ψηφοφορίες</h1>
      <button type="button" class="btn btn-primary" (click)="togglePanel()">
        {{ panelOpen() ? 'Κλείσιμο φόρμας' : 'Νέα ψηφοφορία' }}
      </button>
    </div>

    @if (panelOpen()) {
      <div class="card mb-6">
        <h2 class="card-title">Νέα ψηφοφορία</h2>
        <form [formGroup]="form" (ngSubmit)="create()" class="grid gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="label" for="topic">Θέμα</label>
            <input id="topic" type="text" class="input" formControlName="topic" />
            @if (submitted() && form.controls.topic.invalid) {
              <p class="field-error">Το θέμα είναι υποχρεωτικό.</p>
            }
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="description">Περιγραφή</label>
            <textarea id="description" rows="3" class="input" formControlName="description"></textarea>
          </div>
          <div>
            <label class="label" for="thresholdType">Πλειοψηφία</label>
            <select id="thresholdType" class="input" formControlName="thresholdType">
              <option value="SIMPLE_MAJORITY">Απλή πλειοψηφία</option>
              <option value="MILLIMES_MAJORITY">Πλειοψηφία χιλιοστών</option>
              <option value="HEADCOUNT">Μέτρηση κεφαλών (1 ανά διαμέρισμα)</option>
            </select>
          </div>
          <div>
            <label class="label" for="closesAt">Λήγει</label>
            <input id="closesAt" type="datetime-local" class="input" formControlName="closesAt" />
            @if (submitted() && form.controls.closesAt.invalid) {
              <p class="field-error">Δώστε έγκυρη ημερομηνία λήξης.</p>
            }
          </div>
          <div>
            <label class="label" for="opensAt">Ανοίγει (προαιρετικό)</label>
            <input id="opensAt" type="datetime-local" class="input" formControlName="opensAt" />
          </div>
          <div class="flex items-end">
            <button type="submit" class="btn btn-primary" [disabled]="saving()">
              Δημιουργία
            </button>
          </div>
        </form>
      </div>
    }

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

            @if (vote.status !== 'SCHEDULED') {
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-secondary !px-3 !py-1 text-xs"
                  (click)="toggleResults(vote.id)"
                >
                  Αποτελέσματα
                </button>
                @if (vote.status === 'OPEN') {
                  <button
                    type="button"
                    class="btn btn-danger !px-3 !py-1 text-xs"
                    (click)="confirmClose.set(vote)"
                  >
                    Κλείσιμο
                  </button>
                }
              </div>
            }

            @if (expandedId() === vote.id) {
              <div class="border-t border-slate-100 pt-3">
                @if (detailLoading()) {
                  <p class="text-xs text-slate-500">Φόρτωση αποτελεσμάτων…</p>
                } @else if (details()[vote.id]; as detail) {
                  <app-vote-tally [tally]="detail.tally" />
                }
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

    @if (confirmClose(); as vote) {
      <app-confirm-modal
        title="Κλείσιμο ψηφοφορίας"
        [message]="'Θα κλείσει η ψηφοφορία «' + vote.topic + '». Η ενέργεια δεν αναιρείται.'"
        confirmLabel="Κλείσιμο"
        [danger]="true"
        (confirmed)="closeVote()"
        (cancelled)="confirmClose.set(null)"
      />
    }
  `,
})
export class AdminVotesPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly votesApi = inject(VotesApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly realtime = inject(RealtimeService);

  protected readonly statusBadge = voteStatusBadge;
  protected readonly thresholdLabel = thresholdLabel;

  protected readonly votes = signal<VoteListItem[]>([]);
  protected readonly details = signal<Record<string, VoteDetail>>({});
  protected readonly expandedId = signal<string | null>(null);
  protected readonly detailLoading = signal(false);

  protected readonly panelOpen = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly confirmClose = signal<VoteListItem | null>(null);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    topic: ['', Validators.required],
    description: [''],
    thresholdType: this.fb.nonNullable.control<VoteThresholdType>('SIMPLE_MAJORITY'),
    closesAt: ['', Validators.required],
    opensAt: [''],
  });

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

    // Live tallies: refresh the open vote's detail when a ballot lands or the
    // vote closes, so the page never shows a stale count.
    this.realtime.on<{ voteId: string }>('vote.updated', (event) => {
      if (this.expandedId() === event.voteId) void this.loadDetail(event.voteId);
      this.refreshList();
    });
    this.realtime.on<{ voteId: string }>('vote.closed', (event) => {
      if (this.expandedId() === event.voteId) void this.loadDetail(event.voteId);
      this.refreshList();
    });
  }

  private refreshList(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.votesApi
      .list(buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((votes) => this.votes.set(votes));
  }

  protected togglePanel(): void {
    this.panelOpen.update((open) => !open);
  }

  protected reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    this.expandedId.set(null);
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
      });
  }

  protected create(): void {
    const buildingId = this.buildingId;
    this.submitted.set(true);
    if (!buildingId || this.form.invalid || this.saving()) return;
    const dto = buildCreateVoteDto(this.form.getRawValue());
    if (!dto) return;
    this.saving.set(true);
    this.votesApi
      .create(buildingId, dto)
      .pipe(
        catchError(() => {
          this.toast.error('Η δημιουργία απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η ψηφοφορία δημιουργήθηκε.');
        this.saving.set(false);
        this.submitted.set(false);
        this.form.reset({
          topic: '',
          description: '',
          thresholdType: 'SIMPLE_MAJORITY',
          closesAt: '',
          opensAt: '',
        });
        this.panelOpen.set(false);
        this.reload();
      });
  }

  protected toggleResults(voteId: string): void {
    if (this.expandedId() === voteId) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(voteId);
    void this.loadDetail(voteId);
  }

  /** Fetch (or refresh) the detail of one vote. */
  private loadDetail(voteId: string): void {
    this.detailLoading.set(true);
    this.votesApi
      .detail(voteId)
      .pipe(
        catchError(() => {
          this.toast.error('Η φόρτωση αποτελεσμάτων απέτυχε.');
          this.detailLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((detail) => {
        this.details.update((map) => ({ ...map, [voteId]: detail }));
        this.detailLoading.set(false);
      });
  }

  protected closeVote(): void {
    const vote = this.confirmClose();
    this.confirmClose.set(null);
    if (!vote) return;
    this.votesApi
      .close(vote.id)
      .pipe(
        catchError(() => {
          this.toast.error('Το κλείσιμο απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η ψηφοφορία έκλεισε.');
        this.reload();
      });
  }

  protected closesLabel(closesAt: string): string {
    return closesAtLabel(closesAt);
  }
}
