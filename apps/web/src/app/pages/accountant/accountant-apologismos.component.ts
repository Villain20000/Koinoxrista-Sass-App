import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { EMPTY, catchError, of } from 'rxjs';
import type { PublicBrandingDto } from '@org/shared';
import { AccountantApiService, ApologismosDto } from '../../core/api/accountant-api.service';
import {
  BrandingApiService,
} from '../../core/api/branding-api.service';
import { formatEuros } from '../../ui/format';

const MONTHS_EL = [
  'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
];

/** "2026-03" → "Μάρτιος 2026" (pure). */
export function monthLabel(periodYearMonth: string): string {
  const [year, month] = periodYearMonth.split('-');
  const index = Number(month) - 1;
  return `${MONTHS_EL[index] ?? month} ${year}`;
}

/**
 * PRINTABLE year-end απολογισμός (annual financial statement) for one
 * building — styled after the resident statement print page.
 * Route: /accountant/buildings/:buildingId/apologismos?year=YYYY
 */
@Component({
  selector: 'app-accountant-apologismos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @media print {
      ::ng-deep body.app-print-statement app-layout header,
      ::ng-deep body.app-print-statement app-layout aside {
        display: none !important;
      }
      ::ng-deep body.app-print-statement app-layout main {
        margin-left: 0 !important;
        padding: 0 !important;
      }
    }
  `,
  template: `
    <div class="mx-auto max-w-4xl">
      <div class="print:hidden mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-bold text-slate-900">Απολογισμός</h1>
        <div class="flex flex-wrap items-end gap-2">
          <label class="label !mb-0" for="apologismos-year">Έτος</label>
          <select
            id="apologismos-year"
            class="input !w-28"
            [value]="year()"
            (change)="onYearChange($event)"
          >
            @for (y of years; track y) {
              <option [value]="y">{{ y }}</option>
            }
          </select>
          <button type="button" class="btn btn-primary" (click)="printSheet()">
            Εκτύπωση
          </button>
          <button type="button" class="btn btn-secondary" (click)="goBack()">
            Πίσω
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="card text-sm text-slate-500">Φόρτωση…</div>
      } @else if (error()) {
        <div class="card border-red-200 bg-red-50 text-sm text-red-700">
          Αποτυχία φόρτωσης απολογισμού.
        </div>
      } @else if (data(); as d) {
        <article class="card overflow-hidden p-8">
          @if (branding(); as b) {
            <div class="-mx-8 -mt-8 mb-6 h-1.5" [style.background-color]="b.primaryColor"></div>
          }
          <header class="mb-6 border-b border-slate-200 pb-4">
            @if (branding(); as b) {
              @if (b.logoUrl) {
                <img
                  [src]="b.logoUrl"
                  [alt]="b.orgName || d.buildingName"
                  class="mb-3 max-h-16 max-w-[240px] object-contain"
                />
              }
              @if (b.orgName) {
                <p
                  class="text-sm font-semibold uppercase tracking-wide"
                  [style.color]="b.primaryColor"
                >
                  {{ b.orgName }}
                </p>
              }
            }
            <h2 class="text-lg font-bold text-slate-900">{{ d.buildingName }}</h2>
            <p class="mt-1 text-sm text-slate-600">
              Ετήσιος απολογισμός κοινοχρήστων — Έτος {{ d.year }}
            </p>
          </header>

          <!-- Έσοδα / έξοδα ανά κατηγορία -->
          <section class="mb-8 grid gap-8 md:grid-cols-2">
            <div>
              <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Έσοδα (χρεώσεις ανά κατηγορία)
              </h3>
              <table class="data-table">
                <tbody>
                  @for (row of d.incomeByCategory; track row.categoryId) {
                    <tr>
                      <td>{{ row.categoryName }}</td>
                      <td class="text-right">{{ euros(row.chargedCents) }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="2" class="py-4 text-center text-slate-500">—</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="font-semibold text-slate-900">
                    <td>ΣΥΝΟΛΟ</td>
                    <td class="text-right">{{ euros(d.totals.chargedCents) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div>
              <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Δαπάνες vs προϋπολογισμό
              </h3>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Κατηγορία</th>
                    <th class="text-right">Προβλεφθείσα</th>
                    <th class="text-right">Πραγματική</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of d.costsByCategory; track row.categoryId) {
                    <tr>
                      <td>{{ row.categoryName }}</td>
                      <td class="text-right">{{ euros(row.plannedCents) }}</td>
                      <td class="text-right">{{ euros(row.actualCents) }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="3" class="py-4 text-center text-slate-500">—</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="font-semibold text-slate-900">
                    <td>ΣΥΝΟΛΟ</td>
                    <td class="text-right">{{ euros(d.totals.plannedCents) }}</td>
                    <td class="text-right">{{ euros(d.totals.actualCents) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <!-- Μηνιαίες εισπράξεις -->
          <section class="mb-8">
            <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Αποτελέσματα ανά μήνα
            </h3>
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
                @for (point of d.monthly; track point.periodYearMonth) {
                  <tr>
                    <td class="whitespace-nowrap">{{ monthLabelOf(point.periodYearMonth) }}</td>
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
                  <td class="text-right">{{ euros(d.totals.invoicedCents) }}</td>
                  <td class="text-right">{{ euros(d.totals.collectedCents) }}</td>
                  <td class="text-right">{{ euros(d.totals.arrearsCents) }}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <!-- Υπόλοιπα ανά διαμέρισμα -->
          <section class="mb-8">
            <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Υπόλοιπα διαμερισμάτων (κλείσιμο έτους)
            </h3>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Διαμέρισμα</th>
                  <th>Ιδιοκτήτης</th>
                  <th class="text-right">Χρεώσεις</th>
                  <th class="text-right">Εισπραγμένα</th>
                  <th class="text-right">Υπόλοιπο</th>
                </tr>
              </thead>
              <tbody>
                @for (unit of d.unitBalances; track unit.unitId) {
                  <tr>
                    <td class="font-medium">{{ unit.unitLabel }}</td>
                    <td>{{ unit.ownerName ?? '—' }}</td>
                    <td class="text-right">{{ euros(unit.invoicedCents) }}</td>
                    <td class="text-right">{{ euros(unit.paidCents) }}</td>
                    <td
                      class="text-right"
                      [class.text-red-700]="unit.balanceCents > 0"
                      [class.text-green-700]="unit.balanceCents === 0"
                    >
                      {{ euros(unit.balanceCents) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="py-6 text-center text-slate-500">
                      Δεν υπάρχουν διαμερίσματα.
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr class="font-semibold text-slate-900">
                  <td colspan="2">ΣΥΝΟΛΟ</td>
                  <td class="text-right">{{ euros(totalsInvoiced(d)) }}</td>
                  <td class="text-right">{{ euros(totalsPaid(d)) }}</td>
                  <td class="text-right">{{ euros(totalsBalance(d)) }}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <!-- Αποτέλεσμα -->
          <section
            class="rounded-lg border p-4"
            [class.border-emerald-200]="d.totals.surplusDeficitCents >= 0"
            [class.bg-emerald-50]="d.totals.surplusDeficitCents >= 0"
            [class.border-red-200]="d.totals.surplusDeficitCents < 0"
            [class.bg-red-50]="d.totals.surplusDeficitCents < 0"
          >
            <p class="text-sm text-slate-700">
              Αποτέλεσμα χρήσης {{ d.year }}:
              <span
                class="font-bold"
                [class.text-emerald-700]="d.totals.surplusDeficitCents >= 0"
                [class.text-red-700]="d.totals.surplusDeficitCents < 0"
              >
                {{
                  d.totals.surplusDeficitCents >= 0 ? 'Πλεόνασμα' : 'Έλλειμμα'
                }}
                {{ euros(Math.abs(d.totals.surplusDeficitCents)) }}
              </span>
              (εισπραγθέντα {{ euros(d.totals.collectedCents) }} − δαπάνες
              {{ euros(d.totals.actualCents) }})
            </p>
          </section>

          @if (branding(); as b) {
            @if (b.footerText) {
              <p class="mt-6 text-center text-xs text-slate-500" [style.color]="b.accentColor">
                {{ b.footerText }}
              </p>
            }
          }

          <p class="mt-6 text-xs text-slate-400">
            Εκτυπώθηκε στις {{ printedAt() }}
          </p>
        </article>
      }
    </div>
  `,
})
export class AccountantApologismosPage implements OnInit, OnDestroy {
  private readonly accountantApi = inject(AccountantApiService);
  private readonly brandingApi = inject(BrandingApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  protected readonly euros = formatEuros;
  protected readonly Math = Math;

  private readonly currentYear = new Date().getFullYear();
  protected readonly years = [
    this.currentYear,
    this.currentYear - 1,
    this.currentYear - 2,
  ];

  protected readonly buildingId =
    this.route.snapshot.paramMap.get('buildingId') ?? '';
  protected readonly year = signal(
    this.route.snapshot.queryParamMap.get('year') ??
      String(this.currentYear),
  );
  protected readonly data = signal<ApologismosDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly printedAt = signal('');
  /** White-label branding; silently falls back to defaults on any error. */
  protected readonly branding = signal<PublicBrandingDto | null>(null);

  ngOnInit(): void {
    this.document.body.classList.add('app-print-statement');
    this.load();
    if (this.buildingId) {
      this.brandingApi
        .getPublic(this.buildingId)
        .pipe(catchError(() => of(null)))
        .subscribe((branding) => {
          if (branding) this.branding.set(branding);
        });
    }
  }

  ngOnDestroy(): void {
    this.document.body.classList.remove('app-print-statement');
  }

  protected load(): void {
    if (!this.buildingId) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(false);
    this.accountantApi
      .apologismos(this.buildingId, Number(this.year()))
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((data) => {
        this.data.set(data);
        this.printedAt.set(
          new Date().toLocaleString('el-GR', {
            dateStyle: 'long',
            timeStyle: 'short',
          }),
        );
        this.loading.set(false);
      });
  }

  protected onYearChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === this.year()) return;
    this.year.set(value);
    this.load();
  }

  protected monthLabelOf(periodYearMonth: string): string {
    return monthLabel(periodYearMonth);
  }

  protected totalsInvoiced(d: ApologismosDto): number {
    return d.unitBalances.reduce((sum, u) => sum + u.invoicedCents, 0);
  }

  protected totalsPaid(d: ApologismosDto): number {
    return d.unitBalances.reduce((sum, u) => sum + u.paidCents, 0);
  }

  protected totalsBalance(d: ApologismosDto): number {
    return d.unitBalances.reduce((sum, u) => sum + u.balanceCents, 0);
  }

  protected printSheet(): void {
    window.print();
  }

  protected goBack(): void {
    window.history.back();
  }
}
