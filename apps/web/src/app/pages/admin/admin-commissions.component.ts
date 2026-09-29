import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import type {
  CommissionSummaryDto,
  JobCommissionDto,
  JobCommissionStatus,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  MarketplaceApiService,
  commissionStatusLabel,
} from '../../core/api/marketplace-api.service';
import { ToastService } from '../../ui/toast.service';
import { formatEuros } from '../../ui/format';
import { BarChartComponent } from '../../ui/charts/bar-chart.component';

type StatusFilter = JobCommissionStatus | '';

/** Chip styling per commission lifecycle state. */
function statusChipClass(status: JobCommissionStatus): string {
  switch (status) {
    case 'PAID':
      return 'bg-green-100 text-green-800';
    case 'WAIVED':
      return 'bg-slate-200 text-slate-600';
    default:
      return 'bg-amber-100 text-amber-800';
  }
}

@Component({
  selector: 'app-admin-commissions',
  imports: [FormsModule, BarChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Προμήθειες πλατφόρμας</h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης. Δοκιμάστε ξανά.
      </div>
    } @else {
      <!-- Year selector -->
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <span class="text-sm font-medium text-slate-700">Έτος:</span>
        <div class="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Έτος">
          @for (y of yearOptions; track y) {
            <button
              type="button"
              class="btn !border-transparent !px-3 !py-1 text-xs"
              [class.bg-white]="year() === y"
              [class.shadow-sm]="year() === y"
              [class.font-semibold]="year() === y"
              [attr.aria-pressed]="year() === y"
              (click)="selectYear(y)"
            >
              {{ y }}
            </button>
          }
        </div>
      </div>

      @if (summary(); as data) {
        <div class="mb-4 grid gap-4 sm:grid-cols-3">
          <article class="card">
            <p class="text-sm text-slate-500">Όγκος αναθέσεων {{ data.year }}</p>
            <p class="stat-value mt-1">{{ euros(data.totals.awardedCents) }}</p>
          </article>
          <article class="card">
            <p class="text-sm text-slate-500">Προμήθειες πλατφόρμας</p>
            <p class="stat-value mt-1 text-blue-700">{{ euros(data.totals.commissionCents) }}</p>
            <p class="mt-1 text-xs text-slate-500">{{ effectiveRatePct() }} επί του όγκου</p>
          </article>
          <article class="card">
            <p class="text-sm text-slate-500">Εκκρεμείς (ΟΦΕΙΛΟΜΕΝΕΣ)</p>
            <p class="stat-value mt-1" [class.text-amber-700]="dueCents() > 0">
              {{ euros(dueCents()) }}
            </p>
          </article>
        </div>

        <section class="card mb-6" aria-label="Μηνιαίος όγκος και προμήθειες">
          <h2 class="mb-2 font-semibold text-slate-900">Αναθέσεις vs Προμήθειες ανά μήνα</h2>
          <app-bar-chart
            [labels]="chartLabels()"
            [values]="awardedSeries()"
            [overlayValues]="commissionSeries()"
            [valueFormatter]="euros"
            primaryLabel="Ποσό ανάθεσης"
            secondaryLabel="Προμήθεια"
          />
        </section>
      }

      <!-- Commissions table -->
      <section class="card overflow-x-auto p-0">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <h2 class="font-semibold text-slate-900">Καταγραφή προμηθειών</h2>
          <label class="flex items-center gap-2 text-sm text-slate-600">
            Κατάσταση
            <select class="input !w-40" [ngModel]="statusFilter()" (ngModelChange)="setStatusFilter($event)">
              <option value="">Όλες</option>
              <option value="DUE">Οφειλόμενες</option>
              <option value="PAID">Εξοφλημένες</option>
              <option value="WAIVED">Παραβλεφθείσες</option>
            </select>
          </label>
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th>Ημ/νία ανάθεσης</th>
              <th>Εργασία</th>
              <th>Τεχνικός</th>
              <th>Ποσό βάσης</th>
              <th>Ποσοστό</th>
              <th>Προμήθεια</th>
              <th>Κατάσταση</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (c of filteredCommissions(); track c.id) {
              <tr>
                <td>{{ monthLabel(c.createdAt ?? null) }}</td>
                <td class="font-medium">{{ c.jobTitle || '—' }}</td>
                <td>{{ c.providerName || '—' }}</td>
                <td>{{ euros(c.baseCents) }}</td>
                <td>{{ ratePct(c.rateBps) }}</td>
                <td class="font-semibold">{{ euros(c.amountCents) }}</td>
                <td>
                  <span class="badge inline-flex items-center" [class]="statusChipClass(c.status)">
                    {{ statusLabel(c.status) }}
                  </span>
                  @if (c.paidAt) {
                    <span class="ml-1 text-xs text-slate-400">{{ monthLabel(c.paidAt) }}</span>
                  }
                </td>
                <td class="whitespace-nowrap">
                  @if (c.status === 'DUE') {
                    <button
                      type="button"
                      class="btn btn-primary !px-2 !py-1 text-xs"
                      [disabled]="busyId() === c.id"
                      (click)="markPaid(c)"
                    >
                      Εξόφληση
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary ml-1 !px-2 !py-1 text-xs"
                      [disabled]="busyId() === c.id"
                      (click)="waive(c)"
                    >
                      Παράβλεψη
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="py-8 text-center text-slate-500">
                  Δεν υπάρχουν προμήθειες
                  @if (statusFilter()) { για αυτό το φίλτρο }.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    }
  `,
})
export class AdminCommissionsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly marketplaceApi = inject(MarketplaceApiService);
  private readonly toast = inject(ToastService);

  protected readonly euros = formatEuros;
  protected readonly statusLabel = commissionStatusLabel;
  protected readonly statusChipClass = statusChipClass;

  protected readonly currentYear = new Date().getUTCFullYear();
  protected readonly yearOptions = [
    this.currentYear,
    this.currentYear - 1,
    this.currentYear - 2,
  ];

  protected readonly year = signal(this.currentYear);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly summary = signal<CommissionSummaryDto | null>(null);
  protected readonly commissions = signal<JobCommissionDto[]>([]);
  protected readonly statusFilter = signal<StatusFilter>('');
  protected readonly busyId = signal<string | null>(null);

  private buildingId: string | null = null;

  /** Effective take-rate over the yearly volume, e.g. "3,8%". */
  protected readonly effectiveRatePct = computed(() => {
    const data = this.summary();
    if (!data || data.totals.awardedCents === 0) return '—';
    const pct = (data.totals.commissionCents / data.totals.awardedCents) * 100;
    return `${pct.toLocaleString('el-GR', { maximumFractionDigits: 2 })}%`;
  });

  protected readonly dueCents = computed(() =>
    this.commissions()
      .filter((c) => c.status === 'DUE')
      .reduce((acc, c) => acc + c.amountCents, 0),
  );

  protected readonly filteredCommissions = computed(() => {
    const filter = this.statusFilter();
    const items = this.commissions();
    return filter ? items.filter((c) => c.status === filter) : items;
  });

  protected readonly chartLabels = computed(
    () => this.summary()?.months.map((m) => m.month) ?? [],
  );

  protected readonly awardedSeries = computed(
    () => this.summary()?.months.map((m) => m.awardedCents) ?? [],
  );

  protected readonly commissionSeries = computed(
    () => this.summary()?.months.map((m) => m.commissionCents) ?? [],
  );

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected selectYear(year: number): void {
    if (this.year() === year) return;
    this.year.set(year);
    if (!this.buildingId) return;
    // The list is not year-scoped server-side; the chart is.
    this.marketplaceApi
      .commissionSummary(this.buildingId, year)
      .pipe(catchError(() => EMPTY))
      .subscribe((summary) => this.summary.set(summary));
  }

  protected setStatusFilter(value: string): void {
    this.statusFilter.set((value || '') as StatusFilter);
  }

  protected ratePct(rateBps: number): string {
    return `${(rateBps / 100).toLocaleString('el-GR', { maximumFractionDigits: 2 })}%`;
  }

  /** `YYYY-MM` slice of an ISO timestamp; em-dash when missing. */
  protected monthLabel(iso: string | null): string {
    return iso ? iso.slice(0, 10) : '—';
  }

  protected markPaid(commission: JobCommissionDto): void {
    if (this.busyId()) return;
    this.busyId.set(commission.id);
    this.marketplaceApi.markPaid(commission.id).subscribe({
      next: () => {
        this.toast.success('Η προμήθεια εξοφλήθηκε.');
        this.busyId.set(null);
        this.reloadCommissions();
      },
      error: () => {
        this.toast.error('Η εξόφληση απέτυχε.');
        this.busyId.set(null);
      },
    });
  }

  protected waive(commission: JobCommissionDto): void {
    if (this.busyId()) return;
    this.busyId.set(commission.id);
    this.marketplaceApi.waive(commission.id).subscribe({
      next: () => {
        this.toast.success('Η προμήθεια παραβλέφθηκε.');
        this.busyId.set(null);
        this.reloadCommissions();
      },
      error: () => {
        this.toast.error('Η παράβλεψη απέτυχε.');
        this.busyId.set(null);
      },
    });
  }

  private reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    forkJoin({
      summary: this.marketplaceApi.commissionSummary(this.buildingId, this.year()),
      commissions: this.marketplaceApi.commissions(this.buildingId),
    })
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ summary, commissions }) => {
        this.summary.set(summary);
        this.commissions.set(commissions);
        this.loading.set(false);
      });
  }

  private reloadCommissions(): void {
    if (!this.buildingId) return;
    this.marketplaceApi
      .commissions(this.buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((commissions) => this.commissions.set(commissions));
  }
}
