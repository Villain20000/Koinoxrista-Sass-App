import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin, map } from 'rxjs';
import { CreateWorkLogDto, JobStatus, MyPayoutDto, WorkLogView } from '@org/shared';
import {
  JobWithBids,
  JobsApiService,
  ProviderProfile,
  ProviderProfileApiService,
  jobStatusBadge,
} from '../../core/api/jobs-api.service';
import {
  PayoutsApiService,
  supplierPaymentMethodLabel,
} from '../../core/api/payouts-api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';
import {
  HelpTourComponent,
  HelpTourStep,
} from '../../ui/help-tour.component';
import { TourService } from '../../core/tour.service';

type ProviderTab = 'MARKET' | 'MINE' | 'PROFILE';

/** Finds the current provider's still-active bid on a job (pure). */
export function findOwnActiveBid(
  job: Pick<JobWithBids, 'bids'>,
  userId: string | null | undefined,
): NonNullable<JobWithBids['bids']>[number] | null {
  return (
    job.bids?.find(
      (bid) => bid.providerUserId === userId && bid.status === 'SUBMITTED',
    ) ?? null
  );
}

/** Splits a comma-separated cert string into clean chips (pure). */
export function parseCerts(value: string): string[] {
  return value
    .split(',')
    .map((cert) => cert.trim())
    .filter(Boolean);
}

/** Extended profile fields returned/stored alongside trade and certs. */
type ProfileExtras = {
  city?: string | null;
  bio?: string | null;
  hourlyRateCents?: number | null;
};

/** PUT payload for the provider profile (extra keys sent as-is). */
type ProfilePayload = {
  trade: string;
  certs: string[];
} & ProfileExtras;

@Component({
  selector: 'app-provider-portal',
  imports: [ReactiveFormsModule, HelpTourComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap gap-2">
      <button
        type="button"
        class="btn !px-3 !py-1 text-xs"
        [class.btn-primary]="tab() === 'MARKET'"
        [class.btn-secondary]="tab() !== 'MARKET'"
        (click)="tab.set('MARKET')"
      >
        Αγορά
      </button>
      <button
        type="button"
        class="btn !px-3 !py-1 text-xs"
        [class.btn-primary]="tab() === 'MINE'"
        [class.btn-secondary]="tab() !== 'MINE'"
        (click)="tab.set('MINE')"
      >
        Οι εργασίες μου
      </button>
      <button
        type="button"
        class="btn !px-3 !py-1 text-xs"
        [class.btn-primary]="tab() === 'PROFILE'"
        [class.btn-secondary]="tab() !== 'PROFILE'"
        (click)="tab.set('PROFILE')"
      >
        Προφίλ
      </button>
    </div>

    @switch (tab()) {
      @case ('MARKET') {
        <h1 class="mb-4 text-xl font-bold text-slate-900">Αγορά εργασιών</h1>
        @if (loading()) {
          <div class="card text-sm text-slate-500">Φόρτωση…</div>
        } @else if (marketJobs().length === 0) {
          <div class="card text-sm text-slate-500">
            Δεν υπάρχουν ανοιχτές εργασίες προς προσφορά αυτή τη στιγμή.
          </div>
        }
        <div class="flex flex-col gap-4">
          @for (job of marketJobs(); track job.id) {
            <div class="card">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h2 class="font-semibold text-slate-900">{{ job.title }}</h2>
                  @if (job.buildingName) {
                    <p class="text-xs text-slate-500">{{ job.buildingName }}</p>
                  }
                </div>
                @if (job.budgetCents !== null && job.budgetCents !== undefined) {
                  <span class="badge bg-slate-200 text-slate-700">
                    Έως {{ euros(job.budgetCents) }}
                  </span>
                }
              </div>
              <p class="mt-1 text-sm text-slate-600">{{ job.description }}</p>

              @if (ownBid(job); as bid) {
                <div class="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <p class="mb-2 text-xs font-semibold text-blue-800">
                    Η προσφορά σας (υπό εξέταση)
                  </p>
                  <div class="flex flex-wrap items-end gap-2">
                    <div>
                      <label class="label !mb-1 text-xs" [for]="'amount-' + job.id">
                        Ποσό €
                      </label>
                      <input
                        [id]="'amount-' + job.id"
                        type="number"
                        min="0"
                        step="0.01"
                        class="input !w-32"
                        [value]="editAmount(job.id) ?? ''"
                        (input)="onEditAmount(job.id, $event)"
                      />
                    </div>
                    <div class="min-w-48 grow">
                      <label class="label !mb-1 text-xs" [for]="'msg-' + job.id">Μήνυμα</label>
                      <input
                        [id]="'msg-' + job.id"
                        type="text"
                        class="input"
                        [value]="editMessage(job.id) ?? (bid.message ?? '')"
                        (input)="onEditMessage(job.id, $event)"
                      />
                    </div>
                    <button
                      type="button"
                      class="btn btn-primary !px-3 !py-1 text-xs"
                      [disabled]="saving()"
                      (click)="updateBid(job.id)"
                    >
                      Ενημέρωση προσφοράς
                    </button>
                  </div>
                  <p class="mt-2 text-xs text-slate-500">
                    Τρέχουσα προσφορά: {{ euros(bid.amountCents) }}
                  </p>
                </div>
              } @else {
                <button
                  type="button"
                  class="btn btn-primary mt-3 !px-3 !py-1 text-xs"
                  (click)="openBidModal(job)"
                >
                  Υποβολή προσφοράς
                </button>
              }
            </div>
          }
        </div>
      }
      @case ('MINE') {
        <h1 class="mb-4 text-xl font-bold text-slate-900">Οι εργασίες μου</h1>
        @if (loading()) {
          <div class="card text-sm text-slate-500">Φόρτωση…</div>
        }
        <div class="flex flex-col gap-6">
          @for (group of mineGroups(); track group.status) {
            <section>
              <h2 class="card-title">{{ group.label }}</h2>
              <div class="flex flex-col gap-4">
                @for (job of group.jobs; track job.id) {
                  <div class="card">
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <h3 class="font-semibold text-slate-900">{{ job.title }}</h3>
                        @if (job.buildingName) {
                          <p class="text-xs text-slate-500">{{ job.buildingName }}</p>
                        }
                      </div>
                      <span class="badge shrink-0" [class]="jobStatusBadge(group.status).cls">
                        {{ jobStatusBadge(group.status).label }}
                      </span>
                    </div>
                    <p class="mt-1 text-sm text-slate-600">{{ job.description }}</p>

                    @if (group.status === 'AWARDED' || group.status === 'IN_PROGRESS') {
                      <div class="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label class="label !mb-1 text-xs" [for]="'log-' + job.id">
                            Νέα καταγραφή εργασίας
                          </label>
                          <textarea
                            [id]="'log-' + job.id"
                            rows="2"
                            class="input"
                            [value]="noteFor(job.id) ?? ''"
                            (input)="onNoteInput(job.id, $event)"
                          ></textarea>
                          <button
                            type="button"
                            class="btn btn-primary mt-2 !px-3 !py-1 text-xs"
                            [disabled]="saving()"
                            (click)="addWorkLog(job.id)"
                          >
                            Καταγραφή
                          </button>
                        </div>
                        <div>
                          <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Ημερολόγιο
                          </p>
                          @if (logsOf(job.id); as logs) {
                            <ol class="flex max-h-48 flex-col gap-2 overflow-y-auto border-l-2 border-slate-200 pl-4">
                              @for (log of logs; track log.id) {
                                <li class="relative text-sm">
                                  <span
                                    class="absolute top-1.5 -left-[21px] h-3 w-3 rounded-full border-2 border-white bg-slate-400"
                                  ></span>
                                  <p>{{ log.note }}</p>
                                  <p class="text-xs text-slate-500">{{ when(log.loggedAt) }}</p>
                                </li>
                              }
                            </ol>
                          } @else {
                            <p class="text-xs text-slate-500">Καμία καταγραφή ακόμη.</p>
                          }
                        </div>
                      </div>
                    }
                  </div>
                } @empty {
                  <p class="text-sm text-slate-500">Καμία εργασία.</p>
                }
              </div>
            </section>
          }
        </div>
      }
      @case ('PROFILE') {
        <h1 class="mb-4 text-xl font-bold text-slate-900">Προφίλ</h1>
        <div class="card max-w-xl">
          @if (profile(); as p) {
              @if (p.ratingStars !== null && p.ratingStars !== undefined) {
              <p class="mb-4 text-sm">
                <span class="text-amber-500">
                  @for (star of starRange(5); track star) {
                    <span>{{ star <= roundedStars(p.ratingStars) ? '★' : '☆' }}</span>
                  }
                </span>
                {{ p.ratingStars }} / 5
                @if ((p.ratingCount ?? null) !== null) {
                  <span class="text-slate-500">({{ p.ratingCount }} αξιολογήσεις)</span>
                }
              </p>
            }
            <form [formGroup]="profileForm" (ngSubmit)="saveProfile()" class="flex flex-col gap-4">
              <div>
                <label class="label" for="trade">Ειδικότητα</label>
                <input id="trade" type="text" class="input" formControlName="trade" />
              </div>
              <div>
                <label class="label" for="certs">Πιστοποιητικά (διαχωρισμένα με κόμμα)</label>
                <input id="certs" type="text" class="input" formControlName="certs" />
                @if (certChips().length) {
                  <div class="mt-2 flex flex-wrap gap-1">
                    @for (chip of certChips(); track chip) {
                      <span class="badge bg-slate-200 text-slate-700">{{ chip }}</span>
                    }
                  </div>
                }
              </div>
              <div>
                <label class="label" for="city">Πόλη</label>
                <input id="city" type="text" class="input" formControlName="city" />
              </div>
              <div>
                <label class="label" for="bio">Βιογραφικό</label>
                <textarea id="bio" rows="3" class="input" formControlName="bio"></textarea>
              </div>
              <div>
                <label class="label" for="hourlyRateCents">Ωρομίσθιο € (προαιρετικό)</label>
                <input
                  id="hourlyRateCents"
                  type="number"
                  min="0"
                  step="0.01"
                  class="input"
                  formControlName="hourlyRateCents"
                />
                @if (profileForm.controls.hourlyRateCents.invalid) {
                  <p class="field-error">Το ωρομίσθιο πρέπει να είναι μη αρνητικός αριθμός.</p>
                }
              </div>
              <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
                Αποθήκευση
              </button>
            </form>
          } @else {
            <p class="text-sm text-slate-500">Φόρτωση…</p>
          }
        </div>
      }
    }

    <section class="mt-8" aria-label="Πληρωμές">
      <h2 class="mb-3 text-lg font-bold text-slate-900">Πληρωμές</h2>
      @if (payouts().length === 0) {
        <div class="card text-sm text-slate-500">
          Δεν υπάρχουν πληρωμές για τις εργασίες σας ακόμη.
        </div>
      }
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ημερομηνία</th>
              <th>Εργασία</th>
              <th>Μέθοδος</th>
              <th>Ποσό</th>
            </tr>
          </thead>
          <tbody>
            @for (payout of payouts(); track payout.id) {
              <tr>
                <td>{{ when(payout.paidAt) }}</td>
                <td class="font-medium">{{ payout.jobTitle }}</td>
                <td>{{ methodLabel(payout.method) }}</td>
                <td class="font-medium">{{ euros(payout.amountCents) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (bidModalJob(); as job) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          class="absolute inset-0 cursor-default bg-slate-900/40"
          (click)="bidModalJob.set(null)"
          aria-label="Κλείσιμο"
        ></button>

        <div class="card relative z-10 w-full max-w-md">
          <h2 class="mb-1 text-base font-semibold text-slate-900">
            Προσφορά για «{{ job.title }}»
          </h2>
          @if (job.buildingName) {
            <p class="mb-3 text-xs text-slate-500">{{ job.buildingName }}</p>
          }
          <form (ngSubmit)="submitBid()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="bidAmount">Ποσό (€)</label>
              <input
                id="bidAmount"
                type="number"
                min="0"
                step="0.01"
                class="input"
                [formControl]="bidAmountCtrl"
              />
              @if (bidSubmitted() && bidAmountCtrl.invalid) {
                <p class="field-error">Δώστε έγκυρο ποσό μεγαλύτερο του μηδενός.</p>
              }
            </div>
            <div>
              <label class="label" for="bidMessage">Μήνυμα (προαιρετικό)</label>
              <textarea
                id="bidMessage"
                rows="2"
                class="input"
                [formControl]="bidMessageCtrl"
              ></textarea>
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="btn btn-secondary"
                (click)="bidModalJob.set(null)"
              >
                Άκυρο
              </button>
              <button type="submit" class="btn btn-primary" [disabled]="saving()">
                Υποβολή
              </button>
            </div>
          </form>
        </div>
      </div>
    }

    @if (showTour()) {
      <app-help-tour
        tourId="provider-portal"
        [steps]="tourSteps"
        (closed)="showTour.set(false)"
      />
    }
  `,
})
export class ProviderPortalPage implements OnInit {
  private readonly jobsApi = inject(JobsApiService);
  private readonly profileApi = inject(ProviderProfileApiService);
  private readonly payoutsApi = inject(PayoutsApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly tour = inject(TourService);

  protected readonly euros = formatEuros;
  protected readonly jobStatusBadge = jobStatusBadge;
  protected readonly methodLabel = supplierPaymentMethodLabel;

  /** Ξενάγηση πρώτης χρήσης για νέους συνεργάτες. */
  protected readonly showTour = signal(this.tour.launch('provider-portal'));
  protected readonly tourSteps: HelpTourStep[] = [
    {
      title: 'Καλώς ήρθατε στην Αγορά!',
      body: 'Βρείτε εργασίες συντήρησης και υποβάλετε τις προσφορές σας.',
      selector: 'h1',
    },
    {
      title: 'Οι καρτέλες σας',
      body: '«Αγορά», «Οι εργασίες μου» και «Προφίλ» — όλα σε ένα μέρος.',
    },
  ];

  protected readonly payouts = signal<MyPayoutDto[]>([]);

  protected readonly tab = signal<ProviderTab>('MARKET');

  protected readonly marketJobs = signal<JobWithBids[]>([]);
  protected readonly mineJobs = signal<JobWithBids[]>([]);
  protected readonly workLogs = signal<Record<string, WorkLogView[]>>({});
  protected readonly workLogNotes = signal<Record<string, string>>({});
  protected readonly editAmounts = signal<Record<string, string>>({});
  protected readonly editMessages = signal<Record<string, string>>({});

  protected readonly profile = signal<ProviderProfile | null>(null);

  protected readonly bidModalJob = signal<JobWithBids | null>(null);
  protected readonly bidAmountCtrl = this.fb.control<number | null>(null, [
    Validators.required,
    Validators.min(0.01),
  ]);
  protected readonly bidMessageCtrl = this.fb.nonNullable.control('');
  protected readonly bidSubmitted = signal(false);

  protected readonly profileForm = this.fb.nonNullable.group({
    trade: [''],
    certs: [''],
    city: [''],
    bio: [''],
    hourlyRateCents: this.fb.control<number | null>(null, [Validators.min(0)]),
  });

  protected readonly saving = signal(false);
  protected readonly loading = signal(true);

  private readonly userId = computed(() => this.auth.currentUser()?.id ?? null);

  protected readonly certChips = computed(() =>
    parseCerts(this.profileForm.controls.certs.value),
  );

  ngOnInit(): void {
    forkJoin({
      market: this.jobsApi.marketplace().pipe(catchError(() => EMPTY)),
      mine: this.jobsApi.mine().pipe(catchError(() => EMPTY)),
    }).subscribe(({ market, mine }) => {
      this.marketJobs.set(market ?? []);
      this.mineJobs.set(mine ?? []);
      this.loading.set(false);
      this.loadMineWorkLogs();
    });
    this.payoutsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((payouts) => this.payouts.set(payouts));
    this.profileApi
      .get()
      .pipe(catchError(() => EMPTY))
      .subscribe((profile) => {
        this.profile.set(profile);
        const extras = profile as ProviderProfile & ProfileExtras;
        this.profileForm.reset({
          trade: profile.trade ?? '',
          certs: profile.certs.join(', '),
          city: extras.city ?? '',
          bio: extras.bio ?? '',
          hourlyRateCents:
            extras.hourlyRateCents !== null && extras.hourlyRateCents !== undefined
              ? extras.hourlyRateCents / 100
              : null,
        });
      });
  }

  protected readonly mineGroups = computed(() => {
    const jobs = this.mineJobs();
    const groups: { status: JobStatus; label: string; jobs: JobWithBids[] }[] = [
      { status: 'AWARDED', label: 'Ανατεθειμένες', jobs: [] },
      { status: 'IN_PROGRESS', label: 'Σε εξέλιξη', jobs: [] },
      { status: 'COMPLETED', label: 'Ολοκληρωμένες', jobs: [] },
    ];
    for (const job of jobs) {
      const group = groups.find((g) => g.status === job.status);
      if (group) group.jobs.push(job);
    }
    return groups.filter((group) => group.jobs.length > 0);
  });

  protected loadMineWorkLogs(): void {
    const targets = this.mineJobs().filter(
      (job) => job.status === 'AWARDED' || job.status === 'IN_PROGRESS',
    );
    if (!targets.length) return;
    forkJoin(
      targets.map((job) =>
        this.jobsApi.workLogs(job.id).pipe(
          catchError(() => EMPTY),
          map((logs) => [job.id, logs] as const),
        ),
      ),
    ).subscribe((pairs) => {
      this.workLogs.update((current) => ({
        ...current,
        ...Object.fromEntries(pairs),
      }));
    });
  }

  protected ownBid(job: JobWithBids) {
    return findOwnActiveBid(job, this.userId());
  }

  /** Logs of a job, or null when there is none yet (pure). */
  protected logsOf(jobId: string): WorkLogView[] | null {
    const logs = this.workLogs()[jobId];
    return logs && logs.length > 0 ? logs : null;
  }

  /** Draft bid amount for a job (undefined when untouched). */
  protected editAmount(jobId: string): string | undefined {
    return this.editAmounts()[jobId];
  }

  /** Draft bid message for a job (undefined when untouched). */
  protected editMessage(jobId: string): string | undefined {
    return this.editMessages()[jobId];
  }

  /** Draft work-log note for a job (undefined when untouched). */
  protected noteFor(jobId: string): string | undefined {
    return this.workLogNotes()[jobId];
  }

  protected openBidModal(job: JobWithBids): void {
    this.bidSubmitted.set(false);
    this.bidAmountCtrl.reset(null);
    this.bidMessageCtrl.reset('');
    this.bidModalJob.set(job);
  }

  protected submitBid(): void {
    const job = this.bidModalJob();
    this.bidSubmitted.set(true);
    if (!job || this.bidAmountCtrl.invalid || this.saving()) return;
    const cents = eurosToCents(this.bidAmountCtrl.value ?? NaN);
    if (!Number.isFinite(cents) || cents <= 0) return;
    this.saving.set(true);
    this.jobsApi
      .createBid(job.id, {
        amountCents: cents,
        message: this.bidMessageCtrl.value.trim() || undefined,
      })
      .pipe(
        catchError(() => {
          this.toast.error('Η υποβολή της προσφοράς απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η προσφορά υποβλήθηκε.');
        this.saving.set(false);
        this.bidModalJob.set(null);
        this.reloadMarket();
      });
  }

  protected onEditAmount(jobId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.editAmounts.update((m) => ({ ...m, [jobId]: value }));
  }

  protected onEditMessage(jobId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.editMessages.update((m) => ({ ...m, [jobId]: value }));
  }

  protected updateBid(jobId: string): void {
    const raw = this.editAmounts()[jobId];
    const cents = eurosToCents(raw ?? '');
    if (!Number.isFinite(cents) || cents <= 0) {
      this.toast.error('Δώστε έγκυρο ποσό.');
      return;
    }
    if (this.saving()) return;
    this.saving.set(true);
    this.jobsApi
      .createBid(jobId, {
        amountCents: cents,
        message: this.editMessages()[jobId]?.trim() || undefined,
      })
      .pipe(
        catchError(() => {
          this.toast.error('Η ενημέρωση απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η προσφορά ενημερώθηκε.');
        this.saving.set(false);
        this.reloadMarket();
      });
  }

  protected onNoteInput(jobId: string, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.workLogNotes.update((m) => ({ ...m, [jobId]: value }));
  }

  protected addWorkLog(jobId: string): void {
    const note = (this.workLogNotes()[jobId] ?? '').trim();
    if (!note || this.saving()) return;
    const dto: CreateWorkLogDto = { note };
    this.saving.set(true);
    this.jobsApi
      .addWorkLog(jobId, dto)
      .pipe(
        catchError(() => {
          this.toast.error('Η καταγραφή απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe((log) => {
        this.toast.success('Η καταγραφή αποθηκεύτηκε.');
        this.saving.set(false);
        this.workLogNotes.update((m) => ({ ...m, [jobId]: '' }));
        this.workLogs.update((current) => ({
          ...current,
          [jobId]: [...(current[jobId] ?? []), log],
        }));
      });
  }

  protected saveProfile(): void {
    if (this.saving()) return;
    const rate = this.profileForm.controls.hourlyRateCents;
    if (rate.invalid) {
      this.toast.error('Το ωρομίσθιο πρέπει να είναι μη αρνητικός αριθμός.');
      return;
    }
    this.saving.set(true);
    const { trade, certs, city, bio, hourlyRateCents } = this.profileForm.getRawValue();
    const payload: ProfilePayload = {
      trade: trade.trim(),
      certs: parseCerts(certs),
    };
    if (city.trim()) payload.city = city.trim();
    if (bio.trim()) payload.bio = bio.trim();
    if (hourlyRateCents !== null && hourlyRateCents >= 0) {
      payload.hourlyRateCents = eurosToCents(hourlyRateCents);
    }
    this.profileApi
      .update(payload)
      .pipe(
        catchError(() => {
          this.toast.error('Η αποθήκευση απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe((profile) => {
        this.toast.success('Το προφίλ αποθηκεύτηκε.');
        this.profile.set(profile);
        this.saving.set(false);
      });
  }

  protected starRange(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  protected roundedStars(value: number): number {
    return Math.round(value);
  }

  protected when(iso: string | undefined): string {
    return iso
      ? new Date(iso).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' })
      : '';
  }

  private reloadMarket(): void {
    this.jobsApi
      .marketplace()
      .pipe(catchError(() => EMPTY))
      .subscribe((jobs) => this.marketJobs.set(jobs));
  }
}
