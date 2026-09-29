import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { EMPTY, catchError } from 'rxjs';

import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  ReportCategoryTotal,
  ReportSummary,
  ReportsApiService,
} from '../../core/api/reports-api.service';
import { formatEuros } from '../../ui/format';
import { BarChartComponent } from '../../ui/charts/bar-chart.component';
import { pctOfMax } from '../../ui/charts/chart-utils';

interface CategoryRow extends ReportCategoryTotal {
  pct: number;
}

@Component({
  selector: 'app-admin-analytics',
  imports: [BarChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-xl font-bold text-slate-900">Στατιστικά</h1>
      <div
        class="flex gap-1 rounded-lg bg-slate-100 p-1"
        role="group"
        aria-label="Εύρος περιόδου"
      >
        @for (m of monthOptions; track m) {
          <button
            type="button"
            class="btn !border-transparent !px-3 !py-1 text-xs"
            [class.bg-white]="months() === m"
            [class.shadow-sm]="months() === m"
            [class.font-semibold]="months() === m"
            [attr.aria-pressed]="months() === m"
            (click)="selectMonths(m)"
          >
            {{ m }} μήνες
          </button>
        }
      </div>
    </div>

    @if (loading()) {
      <div class="grid gap-4 sm:grid-cols-3">
        <div class="card animate-pulse"><div class="h-5 w-2/3 rounded bg-slate-200"></div></div>
        <div class="card animate-pulse"><div class="h-5 w-2/3 rounded bg-slate-200"></div></div>
        <div class="card animate-pulse"><div class="h-5 w-2/3 rounded bg-slate-200"></div></div>
      </div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης στατιστικών. Δοκιμάστε ξανά.
      </div>
    } @else if (summary(); as data) {
      <div class="mb-6 grid gap-4 sm:grid-cols-3">
        <article class="card">
          <p class="text-sm text-slate-500">Ποσοστό είσπραξης</p>
          <p
            class="stat-value mt-1"
            [class.text-green-700]="data.totals.collectionRatePct >= 80"
            [class.text-red-600]="data.totals.collectionRatePct < 50"
          >
            {{ data.totals.collectionRatePct }}%
          </p>
          <p class="mt-1 text-xs text-slate-500">
            {{ euros(data.totals.collectedCents) }} από
            {{ euros(data.totals.invoicedCents) }}
          </p>
        </article>

        <article class="card">
          <p class="text-sm text-slate-500">Ανοιχτά υπόλοιπα</p>
          <p
            class="stat-value mt-1"
            [class.text-red-600]="data.totals.arrearsCents > 0"
            [class.text-green-700]="data.totals.arrearsCents === 0"
          >
            {{ euros(data.totals.arrearsCents) }}
          </p>
        </article>

        <article class="card">
          <p class="text-sm text-slate-500">
            Τρέχων μήνας {{ currentPeriod()?.periodYearMonth }}
          </p>
          <p class="stat-value mt-1">{{ euros(currentInvoiced()) }}</p>
          <p class="mt-1 text-xs text-slate-500">
            Εισπράξεις: {{ euros(currentCollected()) }}
          </p>
        </article>
      </div>

      <section class="card mb-6" aria-label="Πιστώσεις και εισπράξεις ανά μήνα">
        <h2 class="mb-2 font-semibold text-slate-900">
          Πιστώσεις vs Εισπράξεις ανά μήνα
        </h2>
        <app-bar-chart
          [labels]="chartLabels()"
          [values]="invoicedSeries()"
          [overlayValues]="collectedSeries()"
          [valueFormatter]="euros"
          primaryLabel="Πιστώσεις"
          secondaryLabel="Εισπράξεις"
        />
      </section>

      <section class="card" aria-label="Δαπάνες ανά κατηγορία">
        <h2 class="mb-3 font-semibold text-slate-900">
          Δαπάνες ανά κατηγορία
        </h2>
        @for (row of categoryRows(); track row.categoryName) {
          <div class="mb-3">
            <div class="mb-1 flex justify-between text-xs text-slate-600">
              <span>{{ row.categoryName }}</span>
              <span>{{ euros(row.totalCents) }}</span>
            </div>
            <div class="h-2 w-full rounded bg-slate-200">
              <div
                class="h-2 rounded bg-blue-400"
                [style.width.%]="row.pct"
              ></div>
            </div>
          </div>
        } @empty {
          <p class="text-sm text-slate-500">Δεν υπάρχουν δαπάνες στο διάστημα.</p>
        }
      </section>
    }
  `,
})
export class AdminAnalyticsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly reportsApi = inject(ReportsApiService);

  protected readonly euros = formatEuros;

  protected readonly monthOptions = [6, 12, 18, 24] as const;
  protected readonly months = signal<number>(12);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly summary = signal<ReportSummary | null>(null);

  private buildingId: string | null = null;

  protected readonly currentPeriod = computed(
    () => this.summary()?.periods.at(-1) ?? null,
  );

  protected readonly currentInvoiced = computed(
    () => this.currentPeriod()?.invoicedCents ?? 0,
  );

  protected readonly currentCollected = computed(
    () => this.currentPeriod()?.collectedCents ?? 0,
  );

  protected readonly invoicedSeries = computed(() =>
    this.summary()?.periods.map((point) => point.invoicedCents) ?? [],
  );

  protected readonly collectedSeries = computed(() =>
    this.summary()?.periods.map((point) => point.collectedCents) ?? [],
  );

  protected readonly chartLabels = computed(() =>
    this.summary()?.periods.map((point) => point.periodYearMonth) ?? [],
  );

  protected readonly categoryRows = computed<CategoryRow[]>(() => {
    const categories = this.summary()?.expensesByCategory ?? [];
    const max = Math.max(...categories.map((c) => c.totalCents), 0);
    return categories.map((category) => ({
      ...category,
      pct: pctOfMax(category.totalCents, max),
    }));
  });

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.loadSummary();
      });
  }

  protected selectMonths(months: number): void {
    if (this.months() === months) return;
    this.months.set(months);
    this.loadSummary();
  }

  private loadSummary(): void {
    if (!this.buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    this.reportsApi
      .summary(this.buildingId, this.months())
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((report) => {
        this.summary.set(report);
        this.loading.set(false);
      });
  }
}
