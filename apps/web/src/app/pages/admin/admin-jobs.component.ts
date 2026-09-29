import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin, map } from 'rxjs';
import { Bid, CreateJobDto, JobStatus, WorkLogView } from '@org/shared';
import {
  JobsApiService,
  JobWithBids,
  bidStatusBadge,
  jobStatusBadge,
} from '../../core/api/jobs-api.service';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';

type JobsTab = 'OPEN' | 'ACTIVE' | 'DONE';

const TAB_STATUSES: Record<JobsTab, JobStatus[]> = {
  OPEN: ['OPEN'],
  ACTIVE: ['AWARDED', 'IN_PROGRESS'],
  DONE: ['COMPLETED', 'CANCELLED'],
};

/** Filters jobs for a tab (pure). */
export function jobsForTab(jobs: JobWithBids[], tab: JobsTab): JobWithBids[] {
  const statuses = TAB_STATUSES[tab];
  return jobs.filter((job) => statuses.includes(job.status));
}

@Component({
  selector: 'app-admin-jobs',
  imports: [ReactiveFormsModule, ConfirmModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold text-slate-900">Εργασίες</h1>
      <button type="button" class="btn btn-primary" (click)="togglePanel()">
        {{ panelOpen() ? 'Κλείσιμο φόρμας' : 'Νέα εργασία' }}
      </button>
    </div>

    @if (panelOpen()) {
      <div class="card mb-6">
        <h2 class="card-title">Νέα εργασία</h2>
        <form [formGroup]="form" (ngSubmit)="create()" class="grid gap-4 sm:grid-cols-3">
          <div class="sm:col-span-3">
            <label class="label" for="title">Τίτλος</label>
            <input id="title" type="text" class="input" formControlName="title" />
            @if (submitted() && form.controls.title.invalid) {
              <p class="field-error">Ο τίτλος είναι υποχρεωτικός.</p>
            }
          </div>
          <div class="sm:col-span-3">
            <label class="label" for="description">Περιγραφή</label>
            <textarea id="description" rows="3" class="input" formControlName="description"></textarea>
            @if (submitted() && form.controls.description.invalid) {
              <p class="field-error">Η περιγραφή είναι υποχρεωτική.</p>
            }
          </div>
          <div>
            <label class="label" for="budget">Προϋπολογισμός € (προαιρετικό)</label>
            <input id="budget" type="number" min="0" step="0.01" class="input" formControlName="budget" />
          </div>
          <div class="flex items-end">
            <button type="submit" class="btn btn-primary" [disabled]="saving()">
              Δημιουργία
            </button>
          </div>
        </form>
      </div>
    }

    <div class="mb-4 flex gap-2">
      @for (t of tabKeys; track t) {
        <button
          type="button"
          class="btn !px-3 !py-1 text-xs"
          [class.btn-primary]="tab() === t"
          [class.btn-secondary]="tab() !== t"
          (click)="selectTab(t)"
        >
          {{ tabLabel(t) }}
        </button>
      }
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης εργασιών.
      </div>
    } @else {
      <div class="flex flex-col gap-4">
        @for (job of visibleJobs(); track job.id) {
          <div class="card">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h2 class="font-semibold text-slate-900">{{ job.title }}</h2>
                <p class="mt-1 text-sm text-slate-600">{{ job.description }}</p>
              </div>
              <span class="badge shrink-0" [class]="jobStatusBadge(job.status).cls">
                {{ jobStatusBadge(job.status).label }}
              </span>
            </div>
            @if (job.budgetCents !== null && job.budgetCents !== undefined) {
              <p class="mt-2 text-sm font-medium text-slate-700">
                Προϋπολογισμός: {{ euros(job.budgetCents) }}
              </p>
            }

            @if ((job.bids?.length ?? 0) > 0 && tab() === 'OPEN') {
              <h3 class="card-title mt-4">Προσφορές</h3>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Πάροχος</th>
                      <th>Ειδικότητα</th>
                      <th>Ποσό</th>
                      <th>Μήνυμα</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (bid of job.bids; track bid.id) {
                      <tr>
                        <td class="font-medium">{{ bid.providerName ?? '—' }}</td>
                        <td>{{ bid.providerTrade || '—' }}</td>
                        <td>{{ euros(bid.amountCents) }}</td>
                        <td>{{ bid.message || '—' }}</td>
                        <td class="whitespace-nowrap text-right">
                          @if (bid.status === 'SUBMITTED') {
                            <button
                              type="button"
                              class="btn btn-primary !px-2 !py-1 text-xs"
                              (click)="askBid(job, bid, true)"
                            >
                              Αποδοχή
                            </button>
                            <button
                              type="button"
                              class="btn btn-secondary ml-1 !px-2 !py-1 text-xs"
                              (click)="askBid(job, bid, false)"
                            >
                              Απόρριψη
                            </button>
                          } @else {
                            <span class="badge" [class]="bidStatusBadge(bid.status).cls">
                              {{ bidStatusBadge(bid.status).label }}
                            </span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            @if (needsWorkLogs(job.status)) {
              <h3 class="card-title mt-4">Ημερολόγιο εργασιών</h3>
              @if (logsOf(job.id); as logs) {
                <ol class="flex flex-col gap-2 border-l-2 border-slate-200 pl-4">
                  @for (log of logs; track log.id) {
                    <li class="relative text-sm">
                      <span
                        class="absolute top-1.5 -left-[21px] h-3 w-3 rounded-full border-2 border-white bg-slate-400"
                      ></span>
                      <p class="text-slate-800">{{ log.note }}</p>
                      <p class="text-xs text-slate-500">{{ when(log.loggedAt) }}</p>
                    </li>
                  }
                </ol>
              } @else {
                <p class="text-xs text-slate-500">Καμία καταγραφή ακόμη.</p>
              }
              @if (job.status === 'AWARDED' || job.status === 'IN_PROGRESS') {
                <button
                  type="button"
                  class="btn btn-primary mt-3 !px-3 !py-1 text-xs"
                  (click)="confirmComplete.set(job)"
                >
                  Ολοκλήρωση
                </button>
              }
            }

            @if (job.status === 'COMPLETED') {
              <div class="mt-4 border-t border-slate-100 pt-3">
                <h3 class="card-title">Αξιολόγηση</h3>
                <div class="flex items-center gap-1">
                  @for (star of starValues; track star) {
                    <button
                      type="button"
                      class="text-2xl leading-none transition-colors"
                      [class.text-amber-400]="(ratingFor(job.id) ?? 0) >= star"
                      [class.text-slate-300]="(ratingFor(job.id) ?? 0) < star"
                      (click)="setStars(job.id, star)"
                      [attr.aria-label]="star + ' αστέρια'"
                    >
                      ★
                    </button>
                  }
                  <button
                    type="button"
                    class="btn btn-primary ml-3 !px-3 !py-1 text-xs"
                    [disabled]="!ratingFor(job.id)"
                    (click)="submitRating(job.id)"
                  >
                    Υποβολή
                  </button>
                </div>
              </div>
            }
          </div>
        } @empty {
          <div class="card text-sm text-slate-500">
            Δεν υπάρχουν εργασίες σε αυτή την κατηγορία.
          </div>
        }
      </div>
    }

    @if (bidConfirm(); as c) {
      <app-confirm-modal
        [title]="c.accept ? 'Αποδοχή προσφοράς' : 'Απόρριψη προσφοράς'"
        [message]="
          (c.accept ? 'Αποδοχή προσφοράς του ' : 'Απόρριψη προσφοράς του ') +
          (c.bid.providerName ?? 'παρόχου') +
          ' για «' + c.job.title + '»; Η ενέργεια δεν αναιρείται.'
        "
        [confirmLabel]="c.accept ? 'Αποδοχή' : 'Απόρριψη'"
        [danger]="!c.accept"
        (confirmed)="resolveBid()"
        (cancelled)="bidConfirm.set(null)"
      />
    }

    @if (confirmComplete(); as job) {
      <app-confirm-modal
        title="Ολοκλήρωση εργασίας"
        [message]="'Θα επισημανθεί η εργασία «' + job.title + '» ως ολοκληρωμένη.'"
        confirmLabel="Ολοκλήρωση"
        (confirmed)="completeJob()"
        (cancelled)="confirmComplete.set(null)"
      />
    }
  `,
})
export class AdminJobsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly jobsApi = inject(JobsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;
  protected readonly jobStatusBadge = jobStatusBadge;
  protected readonly bidStatusBadge = bidStatusBadge;

  protected readonly tabKeys: JobsTab[] = ['OPEN', 'ACTIVE', 'DONE'];
  protected readonly tab = signal<JobsTab>('OPEN');

  protected readonly jobs = signal<JobWithBids[]>([]);
  protected readonly workLogs = signal<Record<string, WorkLogView[]>>({});
  protected readonly ratings = signal<Record<string, number>>({});

  protected readonly panelOpen = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly bidConfirm = signal<{
    job: JobWithBids;
    bid: Bid;
    accept: boolean;
  } | null>(null);
  protected readonly confirmComplete = signal<JobWithBids | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: ['', Validators.required],
    budget: this.fb.control<number | null>(null),
  });

  protected readonly starValues = [1, 2, 3, 4, 5];

  protected readonly visibleJobs = computed(() =>
    jobsForTab(this.jobs(), this.tab()),
  );

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

  protected selectTab(tab: JobsTab): void {
    this.tab.set(tab);
  }

  protected tabLabel(tab: JobsTab): string {
    switch (tab) {
      case 'OPEN':
        return 'Ενεργά';
      case 'ACTIVE':
        return 'Σε εξέλιξη';
      default:
        return 'Ολοκληρωμένα';
    }
  }

  protected togglePanel(): void {
    this.panelOpen.update((open) => !open);
  }

  protected reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    this.jobsApi
      .listForBuilding(buildingId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((jobs) => {
        this.jobs.set(jobs);
        this.loading.set(false);
        this.loadWorkLogs(jobs);
      });
  }

  private loadWorkLogs(jobs: JobWithBids[]): void {
    const withLogs = jobs.filter((job) => this.needsWorkLogs(job.status));
    if (!withLogs.length) return;
    const requests = withLogs.map((job) =>
      this.jobsApi.workLogs(job.id).pipe(
        catchError(() => EMPTY),
        map((logs) => [job.id, logs] as const),
      ),
    );
    forkJoin(requests).subscribe((pairs) => {
      this.workLogs.update((current) => ({
        ...current,
        ...Object.fromEntries(pairs),
      }));
    });
  }

  protected needsWorkLogs(status: JobStatus): boolean {
    return status === 'AWARDED' || status === 'IN_PROGRESS' || status === 'COMPLETED';
  }

  /** Logs of a job, or null when there is none yet (pure). */
  protected logsOf(jobId: string): WorkLogView[] | null {
    const logs = this.workLogs()[jobId];
    return logs && logs.length > 0 ? logs : null;
  }

  /** Selected rating stars for a job (undefined = none picked yet). */
  protected ratingFor(jobId: string): number | undefined {
    return this.ratings()[jobId];
  }

  protected create(): void {
    const buildingId = this.buildingId;
    this.submitted.set(true);
    if (!buildingId || this.form.invalid || this.saving()) return;
    const { title, description, budget } = this.form.getRawValue();
    let dto: CreateJobDto = { title: title.trim(), description: description.trim() };
    if (budget != null && budget > 0) {
      dto = { ...dto, budgetCents: eurosToCents(budget) };
    }
    this.saving.set(true);
    this.jobsApi
      .create(buildingId, dto)
      .pipe(
        catchError(() => {
          this.toast.error('Η δημιουργία απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η εργασία δημιουργήθηκε.');
        this.saving.set(false);
        this.submitted.set(false);
        this.form.reset({ title: '', description: '', budget: null });
        this.panelOpen.set(false);
        this.reload();
      });
  }

  protected askBid(job: JobWithBids, bid: Bid, accept: boolean): void {
    this.bidConfirm.set({ job, bid, accept });
  }

  protected resolveBid(): void {
    const c = this.bidConfirm();
    this.bidConfirm.set(null);
    if (!c) return;
    const request$ = c.accept
      ? this.jobsApi.acceptBid(c.bid.id)
      : this.jobsApi.rejectBid(c.bid.id);
    request$
      .pipe(
        catchError(() => {
          this.toast.error('Η ενέργεια απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success(
          c.accept ? 'Η προσφορά έγινε αποδεκτή.' : 'Η προσφορά απορρίφθηκε.',
        );
        this.reload();
      });
  }

  protected completeJob(): void {
    const job = this.confirmComplete();
    this.confirmComplete.set(null);
    if (!job) return;
    this.jobsApi
      .complete(job.id)
      .pipe(
        catchError(() => {
          this.toast.error('Η ολοκλήρωση απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η εργασία ολοκληρώθηκε.');
        this.reload();
      });
  }

  protected setStars(jobId: string, stars: number): void {
    this.ratings.update((map) => ({ ...map, [jobId]: stars }));
  }

  protected submitRating(jobId: string): void {
    const stars = this.ratings()[jobId];
    if (!stars) return;
    this.jobsApi
      .rate(jobId, stars)
      .pipe(
        catchError(() => {
          this.toast.error('Η αξιολόγηση απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => this.toast.success('Η αξιολόγηση καταχωρήθηκε.'));
  }

  protected when(iso: string | undefined): string {
    return iso
      ? new Date(iso).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' })
      : '';
  }
}
