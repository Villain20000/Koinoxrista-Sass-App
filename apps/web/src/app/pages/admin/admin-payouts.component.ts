import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import {
  PayoutSummaryDto,
  SupplierPaymentDto,
  SupplierPaymentMethod,
} from '@org/shared';
import {
  JobsApiService,
  JobWithBids,
} from '../../core/api/jobs-api.service';
import {
  PayoutsApiService,
  supplierPaymentMethodLabel,
} from '../../core/api/payouts-api.service';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';

@Component({
  selector: 'app-admin-payouts',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Πληρωμές προμηθευτών</h1>

    <div class="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label class="label" for="year">Έτος</label>
        <select id="year" class="input" [formControl]="yearCtrl">
          @for (y of years; track y) {
            <option [value]="y">{{ y }}</option>
          }
        </select>
      </div>
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης πληρωμών. Δοκιμάστε ξανά.
      </div>
    } @else {
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card">
          <p class="text-sm text-slate-500">Σύνολο εξόδων έτους</p>
          <p class="stat-value mt-1">{{ euros(summary().totalCents) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Μέθοδος top</p>
          <p class="stat-value mt-1">{{ topMethodLabel() }}</p>
        </div>
      </div>

      <section class="card mb-6" aria-label="Πληρωμές ανά μήνα">
        <h2 class="card-title mb-3">Ανά μήνα</h2>
        @if (monthBars().length === 0) {
          <p class="text-sm text-slate-500">Καμία πληρωμή για το έτος.</p>
        }
        <div class="flex flex-col gap-2">
          @for (bar of monthBars(); track bar.month) {
            <div class="flex items-center gap-3 text-sm">
              <span class="w-16 shrink-0 text-slate-500">{{ bar.month }}</span>
              <div class="h-4 grow rounded bg-slate-100">
                <div
                  class="h-4 rounded bg-indigo-500"
                  [style.width.%]="bar.pct"
                ></div>
              </div>
              <span class="w-28 shrink-0 text-right font-medium text-slate-700">
                {{ euros(bar.totalCents) }}
              </span>
            </div>
          }
        </div>
      </section>

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="card lg:col-span-1">
          <h2 class="card-title">Νέα πληρωμή</h2>
          <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="amount">Ποσό (€)</label>
              <input
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                class="input"
                formControlName="amount"
              />
              @if (submitted() && form.controls.amount.invalid) {
                <p class="field-error">Δώστε έγκυρο ποσό μεγαλύτερο του μηδενός.</p>
              }
            </div>
            <div>
              <label class="label" for="method">Μέθοδος</label>
              <select id="method" class="input" formControlName="method">
                @for (m of methods; track m.value) {
                  <option [value]="m.value">{{ m.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="paidAt">Ημερομηνία πληρωμής</label>
              <input id="paidAt" type="date" class="input" formControlName="paidAt" />
              @if (submitted() && form.controls.paidAt.invalid) {
                <p class="field-error">Δώστε έγκυρη ημερομηνία.</p>
              }
            </div>
            <div>
              <label class="label" for="jobId">Εργασία (προαιρετικό)</label>
              <select id="jobId" class="input" formControlName="jobId">
                <option value="">— Χωρίς σύνδεση —</option>
                @for (job of jobs(); track job.id) {
                  <option [value]="job.id">{{ job.title }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="reference">Παραστατικό (προαιρετικό)</label>
              <input
                id="reference"
                type="text"
                class="input"
                formControlName="reference"
                placeholder="π.χ. Τιμολόγιο #12"
              />
            </div>
            <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
              Καταχώρηση
            </button>
          </form>
        </div>

        <div class="card overflow-x-auto p-0 lg:col-span-2">
          <table class="data-table">
            <thead>
              <tr>
                <th>Ημερομηνία</th>
                <th>Εργασία / Έξοδο</th>
                <th>Μέθοδος</th>
                <th>Παραστατικό</th>
                <th>Ποσό</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (payment of payments(); track payment.id) {
                <tr>
                  <td>{{ when(payment) }}</td>
                  <td class="font-medium">
                    {{ payment.jobTitle || payment.expenseDescription || '—' }}
                  </td>
                  <td>{{ methodLabel(payment.method) }}</td>
                  <td class="text-slate-500">{{ payment.reference || '—' }}</td>
                  <td class="font-medium">{{ euros(payment.amountCents) }}</td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-secondary !px-2 !py-1 text-xs text-red-600"
                      [disabled]="deleting() === payment.id"
                      (click)="remove(payment)"
                    >
                      Διαγραφή
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="py-8 text-center text-slate-500">
                    Δεν υπάρχουν πληρωμές για το επιλεγμένο έτος.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class AdminPayoutsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly payoutsApi = inject(PayoutsApiService);
  private readonly jobsApi = inject(JobsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;
  protected readonly methodLabel = supplierPaymentMethodLabel;

  protected readonly payments = signal<SupplierPaymentDto[]>([]);
  protected readonly summary = signal<PayoutSummaryDto>({
    totalCents: 0,
    byMethod: [],
    byMonth: [],
  });
  protected readonly jobs = signal<JobWithBids[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly deleting = signal<string | null>(null);

  protected readonly methods: { value: SupplierPaymentMethod; label: string }[] = [
    { value: 'BANK', label: 'Τράπεζα' },
    { value: 'CASH', label: 'Μετρητά' },
    { value: 'CHECK', label: 'Επιταγή' },
    { value: 'CARD', label: 'Κάρτα' },
  ];

  protected readonly currentYear = new Date().getFullYear();
  protected readonly years = Array.from(
    { length: 5 },
    (_, i) => this.currentYear - i,
  );

  protected readonly yearCtrl = new FormControl(String(this.currentYear));

  protected readonly form = this.fb.nonNullable.group({
    amount: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    method: this.fb.nonNullable.control<SupplierPaymentMethod>('BANK'),
    paidAt: [
      new Date().toISOString().slice(0, 10),
      [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)],
    ],
    jobId: [''],
    reference: [''],
  });

  private buildingId: string | null = null;

  constructor() {
    this.yearCtrl.valueChanges.subscribe(() => this.reload());
  }

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.jobsApi
          .listForBuilding(building.id)
          .pipe(catchError(() => EMPTY))
          .subscribe((jobs) => this.jobs.set(jobs));
        this.reload();
      });
  }

  protected readonly topMethodLabel = computed(() => {
    const top = this.summary().byMethod[0];
    return top ? supplierPaymentMethodLabel(top.method) : '—';
  });

  /** Month bars with widths normalized to the busiest month (pure). */
  protected readonly monthBars = computed(() => {
    const months = this.summary().byMonth;
    const max = Math.max(0, ...months.map((m) => m.totalCents));
    return months.map((m) => ({
      ...m,
      pct: max > 0 ? Math.max((m.totalCents / max) * 100, 2) : 0,
    }));
  });

  protected when(payment: SupplierPaymentDto): string {
    return new Date(payment.paidAt).toLocaleDateString('el-GR');
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    const { amount, method, paidAt, jobId, reference } = this.form.getRawValue();
    const cents = eurosToCents(amount ?? NaN);
    if (!Number.isFinite(cents) || cents <= 0) return;
    this.saving.set(true);
    this.payoutsApi
      .create(this.buildingId, {
        amountCents: cents,
        method,
        paidAt: new Date(`${paidAt}T12:00:00.000Z`).toISOString(),
        ...(jobId ? { jobId } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      })
      .subscribe({
        next: () => {
          this.toast.success('Η πληρωμή καταχωρήθηκε.');
          this.saving.set(false);
          this.submitted.set(false);
          this.form.reset({
            amount: null,
            method: 'BANK',
            paidAt: new Date().toISOString().slice(0, 10),
            jobId: '',
            reference: '',
          });
          this.reload();
        },
        error: () => {
          this.toast.error('Η καταχώρηση απέτυχε.');
          this.saving.set(false);
        },
      });
  }

  protected remove(payment: SupplierPaymentDto): void {
    if (!this.buildingId || this.deleting()) return;
    this.deleting.set(payment.id);
    this.payoutsApi
      .remove(payment.id)
      .subscribe({
        next: () => {
          this.toast.success('Η πληρωμή διαγράφηκε.');
          this.deleting.set(null);
          this.reload();
        },
        error: () => {
          this.toast.error('Η διαγραφή απέτυχε.');
          this.deleting.set(null);
        },
      });
  }

  private reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    const year = this.yearCtrl.value ?? String(this.currentYear);
    forkJoin({
      payments: this.payoutsApi.list(this.buildingId, year),
      summary: this.payoutsApi.summary(this.buildingId, year),
    })
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ payments, summary }) => {
        this.payments.set(payments);
        this.summary.set(summary);
        this.loading.set(false);
      });
  }
}
