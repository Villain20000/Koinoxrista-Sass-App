import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import type { ArrearsReport, PayoutSummaryDto } from '@org/shared';
import {
  AccountantApiService,
  AccountantBuildingDto,
  AccountantReportSummary,
} from '../../core/api/accountant-api.service';
import { formatEuros } from '../../ui/format';

type Tab = 'summary' | 'payouts' | 'arrears';

const MONTHS_EL = [
  'Ιαν', 'Φεβ', 'Μάρ', 'Απρ', 'Μάι', 'Ιούν',
  'Ιούλ', 'Αύγ', 'Σεπ', 'Οκτ', 'Νοέ', 'Δεκ',
];

/** "2026-03" → "Μάρ 2026" (pure). */
export function shortMonthLabel(periodYearMonth: string): string {
  const [year, month] = periodYearMonth.split('-');
  return `${MONTHS_EL[Number(month) - 1] ?? month} ${year}`;
}

/**
 * ACCOUNTANT home: building picker + read-only financial views
 * (monthly summary analytics, payouts, late/outstanding charges).
 */
@Component({
  selector: 'app-accountant-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-slate-900">Λογιστής</h1>
        <p class="mt-1 text-sm text-slate-500">
          Μόνο για προβολή οικονομικών στοιχείων των κτιρίων που σας έχουν
          ανατεθεί.
        </p>
      </div>
      <div>
        <label class="label" for="acc-building">Κτίριο</label>
        <select
          id="acc-building"
          class="input !w-72"
          [value]="buildingId()"
          (change)="onBuildingChange($event)"
        >
          @for (b of buildings(); track b.buildingId) {
            <option [value]="b.buildingId">{{ b.name }}</option>
          }
        </select>
      </div>
    </div>

    @if (loading()) {
      <div class="card animate-pulse">
        <div class="h-4 w-1/3 rounded bg-slate-200"></div>
        <div class="mt-3 h-24 w-full rounded bg-slate-100"></div>
      </div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης δεδομένων.
      </div>
    } @else if (buildings().length === 0) {
      <div class="card text-sm text-slate-500">
        Δεν έχετε πρόσβαση σε κάποιο κτίριο ακόμη. Ζητήστε από τον διαχειριστή
        να σας προσθέσει.
      </div>
    } @else {
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav class="flex gap-1 rounded-lg bg-slate-100 p-1">
          @for (t of tabs; track t.id) {
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium"
              [class.bg-white]="tab() === t.id"
              [class.shadow-sm]="tab() === t.id"
              [class.text-slate-900]="tab() === t.id"
              [class.text-slate-500]="tab() !== t.id"
              (click)="tab.set(t.id)"
            >
              {{ t.label }}
            </button>
          }
        </nav>
        <div class="flex items-end gap-2">
          <label class="label !mb-0" for="acc-year">Έτος</label>
          <select
            id="acc-year"
            class="input !w-28"
            [value]="year()"
            (change)="onYearChange($event)"
          >
            @for (y of years; track y) {
              <option [value]="y">{{ y }}</option>
            }
          </select>
          <button
            type="button"
            class="btn btn-secondary"
            (click)="openApologismos()"
          >
            Απολογισμός (εκτύπωση)
          </button>
        </div>
      </div>

      @switch (tab()) {
        @case ('summary') {
          @if (summary(); as s) {
            <section class="grid gap-4 sm:grid-cols-3">
              <div class="card">
                <p class="text-xs uppercase tracking-wide text-slate-500">
                  Ταμειακές εκκρεμότητες
                </p>
                <p class="mt-1 text-lg font-bold text-slate-900">
                  {{ euros(s.totals.arrearsCents) }}
                </p>
              </div>
              <div class="card">
                <p class="text-xs uppercase tracking-wide text-slate-500">
                  Εισπραχθέντα
                </p>
                <p class="mt-1 text-lg font-bold text-emerald-700">
                  {{ euros(s.totals.collectedCents) }}
                </p>
              </div>
              <div class="card">
                <p class="text-xs uppercase tracking-wide text-slate-500">
                  Ποσοστό είσπραξης
                </p>
                <p class="mt-1 text-lg font-bold text-slate-900">
                  {{ s.totals.collectionRatePct }}%
                </p>
              </div>
            </section>
            <div class="card mt-4 overflow-x-auto p-0">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Μήνας</th>
                    <th class="text-right">Παρ/μένα</th>
                    <th class="text-right">Εισπραχθέντα</th>
                    <th class="text-right">Υπόλοιπο</th>
                  </tr>
                </thead>
                <tbody>
                  @for (point of s.periods; track point.periodYearMonth) {
                    <tr>
                      <td>{{ monthLabel(point.periodYearMonth) }}</td>
                      <td class="text-right">{{ euros(point.invoicedCents) }}</td>
                      <td class="text-right">{{ euros(point.collectedCents) }}</td>
                      <td
                        class="text-right"
                        [class.text-red-700]="point.arrearsCents > 0"
                      >
                        {{ euros(point.arrearsCents) }}
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="font-semibold text-slate-900">
                    <td>ΣΥΝΟΛΟ</td>
                    <td class="text-right">{{ euros(s.totals.invoicedCents) }}</td>
                    <td class="text-right">{{ euros(s.totals.collectedCents) }}</td>
                    <td class="text-right">{{ euros(s.totals.arrearsCents) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div class="card mt-4">
              <h2 class="card-title mb-3">Δαπάνες ανά κατηγορία</h2>
              @for (row of s.expensesByCategory; track row.categoryName) {
                <div class="flex items-center justify-between py-1 text-sm">
                  <span class="text-slate-700">{{ row.categoryName }}</span>
                  <span class="font-medium text-slate-900">
                    {{ euros(row.totalCents) }}
                  </span>
                </div>
              } @empty {
                <p class="text-sm text-slate-500">Δεν υπάρχουν δαπάνες.</p>
              }
            </div>
          }
        }
        @case ('payouts') {
          @if (payouts(); as p) {
            <section class="grid gap-4 sm:grid-cols-2">
              <div class="card">
                <p class="text-xs uppercase tracking-wide text-slate-500">
                  Πληρωμές προμηθευτών {{ year() }}
                </p>
                <p class="mt-1 text-lg font-bold text-slate-900">
                  {{ euros(p.totalCents) }}
                </p>
              </div>
              <div class="card">
                <h2 class="card-title mb-2">Ανά μέθοδο</h2>
                @for (m of p.byMethod; track m.method) {
                  <div class="flex justify-between py-0.5 text-sm">
                    <span class="text-slate-600">{{ m.method }}</span>
                    <span class="font-medium">{{ euros(m.totalCents) }}</span>
                  </div>
                } @empty {
                  <p class="text-sm text-slate-500">Καμία πληρωμή.</p>
                }
              </div>
            </section>
            <div class="card mt-4 overflow-x-auto p-0">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Μήνας</th>
                    <th class="text-right">Σύνολο</th>
                  </tr>
                </thead>
                <tbody>
                  @for (m of p.byMonth; track m.month) {
                    <tr>
                      <td>{{ monthLabel(m.month) }}</td>
                      <td class="text-right">{{ euros(m.totalCents) }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="2" class="py-6 text-center text-slate-500">
                        Δεν υπάρχουν πληρωμές για το {{ year() }}.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
        @case ('arrears') {
          @if (arrearsReport(); as r) {
            <div class="card mb-4">
              <p class="text-xs uppercase tracking-wide text-slate-500">
                Σύνολο ληξιπρόθεσμων οφειλών
              </p>
              <p
                class="mt-1 text-lg font-bold"
                [class.text-red-700]="r.totalOutstandingCents > 0"
              >
                {{ euros(r.totalOutstandingCents) }}
              </p>
            </div>
            <div class="card overflow-x-auto p-0">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Διαμέρισμα</th>
                    <th>Ιδιοκτήτης</th>
                    <th class="text-right">Οφειλή</th>
                    <th class="text-right">&gt;90 ημέρες</th>
                    <th>Παλαιότερη ανεξόφλητη</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of r.rows; track row.unitId) {
                    @if (row.outstandingCents > 0) {
                      <tr>
                        <td class="font-medium">{{ row.unitLabel }}</td>
                        <td>{{ ownerNames(row.ownerNames) }}</td>
                        <td class="text-right text-red-700">
                          {{ euros(row.outstandingCents) }}
                        </td>
                        <td class="text-right">
                          {{ euros(row.bucket90PlusCents) }}
                        </td>
                        <td>{{ row.oldestUnpaidPeriod ?? '—' }}</td>
                      </tr>
                    }
                  } @empty {
                    <tr>
                      <td colspan="5" class="py-6 text-center text-slate-500">
                        Καμία ληξιπρόθεσμη οφειλή.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
    }
  `,
})
export class AccountantHomePage implements OnInit {
  private readonly accountantApi = inject(AccountantApiService);
  private readonly router = inject(Router);

  protected readonly euros = formatEuros;

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'Σύνοψη περιόδου' },
    { id: 'payouts', label: 'Πληρωμές προμηθευτών' },
    { id: 'arrears', label: 'Ληξιπρόθεσμες' },
  ];

  private readonly currentYear = new Date().getFullYear();
  protected readonly years = [
    this.currentYear,
    this.currentYear - 1,
    this.currentYear - 2,
  ];

  protected readonly buildings = signal<AccountantBuildingDto[]>([]);
  protected readonly buildingId = signal('');
  protected readonly tab = signal<Tab>('summary');
  protected readonly year = signal(String(this.currentYear));
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly summary = signal<AccountantReportSummary | null>(null);
  protected readonly payouts = signal<PayoutSummaryDto | null>(null);
  protected readonly arrearsReport = signal<ArrearsReport | null>(null);

  protected readonly canLoad = computed(() => this.buildingId() !== '');

  ngOnInit(): void {
    this.accountantApi
      .buildings()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((buildings) => {
        this.buildings.set(buildings);
        const first = buildings[0]?.buildingId ?? '';
        this.buildingId.set(first);
        if (first) {
          this.reload();
        } else {
          this.loading.set(false);
        }
      });
  }

  protected reload(): void {
    const buildingId = this.buildingId();
    if (!buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    forkJoin({
      summary: this.accountantApi.summary(buildingId),
      payouts: this.accountantApi.payoutsSummary(
        buildingId,
        Number(this.year()),
      ),
      arrears: this.accountantApi.arrears(buildingId),
    })
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ summary, payouts, arrears }) => {
        this.summary.set(summary);
        this.payouts.set(payouts);
        this.arrearsReport.set(arrears);
        this.loading.set(false);
      });
  }

  protected onBuildingChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === this.buildingId()) return;
    this.buildingId.set(value);
    this.reload();
  }

  protected onYearChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === this.year()) return;
    this.year.set(value);
    this.reload();
  }

  protected openApologismos(): void {
    void this.router.navigate(
      ['/accountant', 'buildings', this.buildingId(), 'apologismos'],
      { queryParams: { year: this.year() } },
    );
  }

  protected monthLabel(periodYearMonth: string): string {
    return shortMonthLabel(periodYearMonth);
  }

  protected ownerNames(names: string[]): string {
    return names.join(', ');
  }
}
