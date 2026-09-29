import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import type {
  ArrearsReport,
  InstallmentDto,
  PaymentPlanDto,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { UnitsApiService, UnitWithOwners } from '../../core/api/units-api.service';
import {
  PaymentPlansApiService,
  paymentPlanStatusCls,
  paymentPlanStatusLabel,
} from '../../core/api/payment-plans-api.service';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';

const MS_PER_DAY = 86_400_000;

export interface SchedulePreviewRow {
  seq: number;
  dueDate: string;
  amountCents: number;
}

/**
 * Client-side mirror of the API splitter: equal integer parts with the
 * remainder distributed one cent at a time to the earliest installments.
 */
export function previewSchedule(
  totalCents: number,
  installmentCount: number,
  firstDueDate: string,
  intervalDays: number,
): SchedulePreviewRow[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) return [];
  if (!Number.isInteger(installmentCount) || installmentCount < 1) return [];
  const first = new Date(firstDueDate);
  if (Number.isNaN(first.getTime())) return [];

  const base = Math.floor(totalCents / installmentCount);
  let remainder = totalCents % installmentCount;
  return Array.from({ length: installmentCount }, (_, index) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return {
      seq: index + 1,
      dueDate: new Date(first.getTime() + index * intervalDays * MS_PER_DAY)
        .toISOString()
        .slice(0, 10),
      amountCents: base + extra,
    };
  });
}

/** Paid share of a plan as 0–100 (pure). */
export function planProgressPercent(plan: Pick<PaymentPlanDto, 'paidCents' | 'totalCents'>): number {
  if (!plan.totalCents || plan.totalCents <= 0) return 0;
  return Math.min(100, Math.round(((plan.paidCents ?? 0) / plan.totalCents) * 100));
}

/** Greek label for an installment's state (pure). */
export function installmentStateLabel(installment: InstallmentDto): string {
  const paidInFull = installment.paidCents >= installment.amountCents;
  if (paidInFull) return 'Εξοφλήθηκε';
  return installment.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10)
    ? 'Καθυστέρηση'
    : 'Εκκρεμεί';
}

/** Tailwind text color for an installment state (pure). */
export function installmentStateCls(installment: InstallmentDto): string {
  const paidInFull = installment.paidCents >= installment.amountCents;
  if (paidInFull) return 'text-green-700';
  return installment.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10)
    ? 'text-red-600'
    : 'text-slate-500';
}

@Component({
  selector: 'app-admin-payment-plans',
  imports: [ReactiveFormsModule, ConfirmModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Ρυθμίσεις οφειλών</h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης. Δοκιμάστε ξανά.
      </div>
    } @else {
      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Create plan -->
        <section class="card lg:col-span-1">
          <h2 class="card-title mb-3">Νέο πρόγραμμα τμημάτων</h2>
          <form [formGroup]="form" (ngSubmit)="createPlan()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="unitId">Διαμέρισμα</label>
              <select id="unitId" class="input" formControlName="unitId">
                <option value="" disabled>— Επιλογή —</option>
                @for (unit of units(); track unit.id) {
                  <option [value]="unit.id">{{ unit.label }}</option>
                }
              </select>
              @if (submitted() && form.controls.unitId.invalid) {
                <p class="field-error">Επιλέξτε διαμέρισμα.</p>
              }
            </div>
            <div>
              <label class="label" for="totalEuros">Ποσό (€, προαιρετικό)</label>
              <input
                id="totalEuros"
                type="number"
                min="0.01"
                step="0.01"
                class="input"
                formControlName="totalEuros"
                placeholder="Αυτόματο από χρεώσεις"
              />
              @if (selectedOutstanding() !== null) {
                <p class="mt-1 text-xs text-slate-500">
                  Τρέχον ανεξόφλητο: {{ euros(selectedOutstanding()!) }}
                </p>
              }
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label" for="installmentCount">Τμήματα (2–24)</label>
                <input
                  id="installmentCount"
                  type="number"
                  min="2"
                  max="24"
                  class="input"
                  formControlName="installmentCount"
                />
                @if (submitted() && form.controls.installmentCount.invalid) {
                  <p class="field-error">Από 2 έως 24 τμήματα.</p>
                }
              </div>
              <div>
                <label class="label" for="intervalDays">Ανά ημέρες</label>
                <input
                  id="intervalDays"
                  type="number"
                  min="1"
                  max="365"
                  class="input"
                  formControlName="intervalDays"
                />
              </div>
            </div>
            <div>
              <label class="label" for="firstDueDate">Πρώτη λήξη</label>
              <input
                id="firstDueDate"
                type="date"
                class="input"
                formControlName="firstDueDate"
              />
            </div>

            @if (previewRows().length > 0) {
              <div class="overflow-hidden rounded-lg border border-slate-200">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="bg-slate-50 text-left text-slate-500">
                      <th class="px-2 py-1 font-medium">#</th>
                      <th class="px-2 py-1 font-medium">Λήξη</th>
                      <th class="px-2 py-1 text-right font-medium">Ποσό</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of previewRows(); track row.seq) {
                      <tr class="border-t border-slate-100">
                        <td class="px-2 py-1">{{ row.seq }}</td>
                        <td class="px-2 py-1">{{ row.dueDate }}</td>
                        <td class="px-2 py-1 text-right">{{ euros(row.amountCents) }}</td>
                      </tr>
                    }
                    <tr class="border-t border-slate-200 bg-slate-50 font-semibold">
                      <td class="px-2 py-1" colspan="2">Σύνολο</td>
                      <td class="px-2 py-1 text-right">{{ euros(previewTotal()) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            }

            <button type="submit" class="btn btn-primary self-start" [disabled]="creating()">
              Δημιουργία προγράμματος
            </button>
          </form>
        </section>

        <!-- Plans list -->
        <section class="card overflow-x-auto p-0 lg:col-span-2">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
            <h2 class="card-title !mb-0">Προγράμματα</h2>
            <select
              class="input !w-44"
              [value]="statusFilter()"
              (change)="onFilterChange($event)"
              aria-label="Φίλτρο κατάστασης"
            >
              <option value="">Όλες οι καταστάσεις</option>
              <option value="ACTIVE">Ενεργά</option>
              <option value="COMPLETED">Ολοκληρωμένα</option>
              <option value="CANCELLED">Ακυρωμένα</option>
            </select>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Διαμέρισμα</th>
                <th>Σύνολο</th>
                <th>Εξοφλημένο</th>
                <th class="min-w-32">Πρόοδος</th>
                <th>Κατάσταση</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (plan of plans(); track plan.id) {
                <tr>
                  <td class="font-medium">{{ plan.unitLabel || '—' }}</td>
                  <td>{{ euros(plan.totalCents) }} · {{ plan.installmentCount }} τμήματα</td>
                  <td>{{ euros(plan.paidCents ?? 0) }}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="h-2 w-full min-w-16 rounded-full bg-slate-200">
                        <div
                          class="h-2 rounded-full bg-emerald-500"
                          [style.width.%]="progress(plan)"
                        ></div>
                      </div>
                      <span class="whitespace-nowrap text-xs text-slate-500">
                        {{ progress(plan) }}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <span [class]="'badge ' + statusCls(plan.status)">
                      {{ statusLabel(plan.status) }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap text-right">
                    <button
                      type="button"
                      class="btn btn-secondary !px-2 !py-1 text-xs"
                      (click)="openPlan(plan.id)"
                    >
                      Λεπτομέρειες
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="py-8 text-center text-slate-500">
                    Δεν υπάρχουν προγράμματα ακόμη.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      </div>
    }

    <!-- Record-payment / detail dialog -->
    @if (selected(); as plan) {
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
        <button
          type="button"
          class="fixed inset-0 cursor-default bg-slate-900/40"
          (click)="closePlan()"
          aria-label="Κλείσιμο"
        ></button>
        <div class="card relative z-10 my-8 w-full max-w-xl">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-slate-900">
                Πρόγραμμα — {{ plan.unitLabel || '—' }}
              </h2>
              <p class="mt-1 text-sm text-slate-500">
                Σύνολο {{ euros(plan.totalCents) }} · Εξοφλημένο
                {{ euros(plan.paidCents ?? 0) }} · Υπόλοιπο
                {{ euros(plan.remainingCents ?? 0) }}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-secondary !px-2 !py-1 text-xs"
              (click)="closePlan()"
            >
              &times;
            </button>
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Λήξη</th>
                <th>Ποσό</th>
                <th>Πληρώθηκε</th>
                <th>Κατάσταση</th>
              </tr>
            </thead>
            <tbody>
              @for (inst of plan.installments ?? []; track inst.id) {
                <tr>
                  <td>{{ inst.seq }}</td>
                  <td>{{ inst.dueDate.slice(0, 10) }}</td>
                  <td>{{ euros(inst.amountCents) }}</td>
                  <td>{{ euros(inst.paidCents) }}</td>
                  <td [class]="'text-xs font-medium ' + stateCls(inst)">
                    {{ stateLabel(inst) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>

          @if (plan.status === 'ACTIVE') {
            <form [formGroup]="paymentForm" (ngSubmit)="recordPayment()" class="mt-4 flex items-end gap-2">
              <div class="flex-1">
                <label class="label" for="paymentEuros">Καταχώρηση πληρωμής (€)</label>
                <input
                  id="paymentEuros"
                  type="number"
                  min="0.01"
                  step="0.01"
                  class="input"
                  formControlName="paymentEuros"
                />
              </div>
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="paying()"
              >
                Καταχώρηση
              </button>
            </form>
            <p class="mt-2 text-xs text-slate-500">
              Το ποσό κατανέμεται αυτόματα στα παλαιότερα ανεξόφλητα τμήματα·
              μερική εξόφληση τμήματος επιτρέπεται.
            </p>

            <div class="mt-4 border-t border-slate-100 pt-4">
              <button
                type="button"
                class="btn btn-danger"
                [disabled]="cancelling()"
                (click)="confirmingCancel.set(true)"
              >
                Ακύρωση προγράμματος
              </button>
              <p class="mt-1 text-xs text-slate-500">
                Θα αφαιρεθούν τα υπόλοιπα ανεξόφλητα τμήματα ηχογραφημένα στο audit log.
              </p>
            </div>
          }
        </div>
      </div>
    }

    @if (confirmingCancel()) {
      <app-confirm-modal
        title="Ακύρωση προγράμματος"
        message="Τα ανεξόφλητα τμήματα θα αφαιρεθούν οριστικά και η ενέργεια θα καταγραφεί. Συνέχεια;"
        [danger]="true"
        confirmLabel="Ακύρωση προγράμματος"
        (confirmed)="cancelPlan()"
        (cancelled)="confirmingCancel.set(false)"
      />
    }
  `,
})
export class AdminPaymentPlansPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly paymentPlansApi = inject(PaymentPlansApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;
  protected readonly progress = planProgressPercent;
  protected readonly statusLabel = paymentPlanStatusLabel;
  protected readonly statusCls = paymentPlanStatusCls;
  protected readonly stateLabel = installmentStateLabel;
  protected readonly stateCls = installmentStateCls;

  protected readonly units = signal<UnitWithOwners[]>([]);
  protected readonly plans = signal<PaymentPlanDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly submitted = signal(false);
  protected readonly creating = signal(false);
  protected readonly paying = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly confirmingCancel = signal(false);
  protected readonly statusFilter = signal('');

  /** Open dialog plan (freshly fetched with its full schedule). */
  protected readonly selected = signal<PaymentPlanDto | null>(null);

  /** Outstanding per unitId from the arrears report, drives the amount hint/default. */
  private readonly outstandingByUnitId = signal<Map<string, number>>(new Map());

  protected readonly form = this.fb.nonNullable.group({
    unitId: this.fb.nonNullable.control<string>('', {
      validators: [Validators.required],
    }),
    totalEuros: this.fb.nonNullable.control<number | null>(null),
    installmentCount: this.fb.nonNullable.control<number>(3, {
      validators: [Validators.required, Validators.min(2), Validators.max(24)],
    }),
    intervalDays: this.fb.nonNullable.control<number>(30, {
      validators: [Validators.required, Validators.min(1)],
    }),
    firstDueDate: this.fb.nonNullable.control<string>(this.defaultFirstDueDate(), {
      validators: [Validators.required],
    }),
  });

  protected readonly paymentForm = this.fb.nonNullable.group({
    paymentEuros: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
  });

  /** Signal view of the form so the preview recomputes on every keystroke. */
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  /** Live schedule preview reflecting the current form values. */
  protected readonly previewRows = computed(() => {
    const form = this.formValue();
    const unitId = form.unitId ?? '';
    const totalEuros = form.totalEuros;
    const installmentCount = form.installmentCount ?? 2;
    const intervalDays = form.intervalDays ?? 30;
    const firstDueDate = form.firstDueDate ?? '';
    const explicitCents =
      totalEuros !== null && totalEuros !== undefined
        ? eurosToCents(totalEuros)
        : NaN;
    const totalCents =
      Number.isFinite(explicitCents) && explicitCents > 0
        ? explicitCents
        : (this.outstandingByUnitId().get(unitId) ?? 0);
    if (!Number.isFinite(totalCents) || totalCents <= 0) return [];
    return previewSchedule(
      totalCents,
      installmentCount,
      firstDueDate,
      intervalDays,
    );
  });

  protected readonly previewTotal = computed(() =>
    this.previewRows().reduce((sum, row) => sum + row.amountCents, 0),
  );

  protected readonly selectedOutstanding = () => {
    const unitId = this.formValue().unitId;
    return unitId ? (this.outstandingByUnitId().get(unitId) ?? null) : null;
  };

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected createPlan(): void {
    this.submitted.set(true);
    const buildingId = this.buildingId;
    if (!buildingId || this.form.invalid || this.creating()) return;

    const { unitId, totalEuros, installmentCount, intervalDays, firstDueDate } =
      this.form.getRawValue();
    const explicitCents = totalEuros !== null ? eurosToCents(totalEuros) : NaN;
    const dto = {
      unitId,
      installmentCount,
      intervalDays,
      firstDueDate: new Date(`${firstDueDate}T00:00:00.000Z`).toISOString(),
      ...(Number.isFinite(explicitCents) && explicitCents > 0
        ? { totalCents: explicitCents }
        : {}),
    };

    this.creating.set(true);
    this.paymentPlansApi
      .create(buildingId, dto)
      .subscribe({
        next: () => {
          this.toast.success('Το πρόγραμμα δημιουργήθηκε.');
          this.creating.set(false);
          this.submitted.set(false);
          this.reloadPlans();
        },
        error: () => {
          this.toast.error('Η δημιουργία απέτυχε (το διαμέρισμα μπορεί να έχει ήδη ενεργό πρόγραμμα).');
          this.creating.set(false);
        },
      });
  }

  protected openPlan(id: string): void {
    this.paymentPlansApi
      .get(id)
      .pipe(
        catchError(() => {
          this.toast.error('Η φόρτωση του προγράμματος απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe((plan) => {
        this.selected.set(plan);
        this.paymentForm.reset({ paymentEuros: null });
      });
  }

  protected closePlan(): void {
    this.selected.set(null);
    this.confirmingCancel.set(false);
  }

  protected recordPayment(): void {
    const plan = this.selected();
    if (!plan || this.paying()) return;
    const euros = this.paymentForm.getRawValue().paymentEuros;
    if (euros === null || !Number.isFinite(eurosToCents(euros))) return;

    this.paying.set(true);
    this.paymentPlansApi
      .recordPayment(plan.id, eurosToCents(euros))
      .subscribe({
        next: (updated) => {
          this.toast.success('Η πληρωμή καταχωρήθηκε.');
          this.selected.set(updated);
          this.paymentForm.reset({ paymentEuros: null });
          this.paying.set(false);
          this.reloadPlans();
        },
        error: () => {
          this.toast.error('Η καταχώρηση πληρωμής απέτυχε.');
          this.paying.set(false);
        },
      });
  }

  protected cancelPlan(): void {
    const plan = this.selected();
    this.confirmingCancel.set(false);
    if (!plan || this.cancelling()) return;

    this.cancelling.set(true);
    this.paymentPlansApi
      .cancel(plan.id)
      .subscribe({
        next: (updated) => {
          this.toast.success('Το πρόγραμμα ακυρώθηκε.');
          this.selected.set(updated);
          this.cancelling.set(false);
          this.reloadPlans();
        },
        error: () => {
          this.toast.error('Η ακύρωση απέτυχε.');
          this.cancelling.set(false);
        },
      });
  }

  protected onFilterChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.reloadPlans();
  }

  private reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loadError.set(false);
    forkJoin({
      units: this.unitsApi.list(buildingId),
      arrears: this.buildingsApi.arrears(buildingId),
      plans: this.paymentPlansApi.list(buildingId),
    })
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ units, arrears, plans }) => {
        this.units.set(units);
        this.outstandingByUnitId.set(this.mapOutstanding(arrears));
        this.plans.set(plans);
        this.loading.set(false);
      });
  }

  private reloadPlans(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.paymentPlansApi
      .list(buildingId, this.statusFilter() || undefined)
      .pipe(catchError(() => EMPTY))
      .subscribe((plans) => this.plans.set(plans));
  }

  private mapOutstanding(report: ArrearsReport): Map<string, number> {
    return new Map(report.rows.map((row) => [row.unitId, row.outstandingCents]));
  }

  private defaultFirstDueDate(): string {
    return new Date(Date.now() + 30 * MS_PER_DAY).toISOString().slice(0, 10);
  }
}
