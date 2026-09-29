import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { EMPTY, catchError, of } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import {
  BrandingApiService,
} from '../../core/api/branding-api.service';
import type { PublicBrandingDto } from '@org/shared';
import {
  ResidentStatement,
  StatementsApiService,
} from '../../core/api/statements-api.service';
import { formatEuros } from '../../ui/format';

const MONTHS_EL = [
  'Ιανουάριος',
  'Φεβρουάριος',
  'Μάρτιος',
  'Απρίλιος',
  'Μάιος',
  'Ιούνιος',
  'Ιούλιος',
  'Αύγουστος',
  'Σεπτέμβριος',
  'Οκτώβριος',
  'Νοέμβριος',
  'Δεκέμβριος',
];

/** "2026-03" → "Μάρτιος 2026" (pure). */
export function monthLabel(periodYearMonth: string): string {
  const [year, month] = periodYearMonth.split('-');
  const index = Number(month) - 1;
  return `${MONTHS_EL[index] ?? month} ${year}`;
}

@Component({
  selector: 'app-resident-statement',
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
    <div class="mx-auto max-w-3xl">
      <div class="print:hidden mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-bold text-slate-900">Ετήσιο αποδεικτικό</h1>
        <div class="flex flex-wrap items-end gap-2">
          <label class="label !mb-0" for="statement-year">Έτος</label>
          <select
            id="statement-year"
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
        </div>
      </div>

      @if (loading()) {
        <div class="card text-sm text-slate-500">Φόρτωση…</div>
      } @else if (error()) {
        <div class="card border-red-200 bg-red-50 text-sm text-red-700">
          Αποτυχία φόρτωσης αποδεικτικού. Δοκιμάστε να ανανεώσετε τη σελίδα.
        </div>
      } @else if (statement(); as s) {
        <article class="card overflow-hidden p-8">
          @if (branding(); as b) {
            <div
              class="-mx-8 -mt-8 mb-6 h-1.5"
              [style.background-color]="b.primaryColor"
            ></div>
          }
          <header class="mb-6 border-b border-slate-200 pb-4">
            @if (branding(); as b) {
              @if (b.logoUrl) {
                <img
                  [src]="b.logoUrl"
                  [alt]="b.orgName || s.buildingName"
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
            <h2 class="text-lg font-bold text-slate-900">
              {{ s.buildingName }}
            </h2>
            <p class="mt-1 text-sm text-slate-600">
              Ετήσιο αποδεικτικό κοινοχρήστων — Έτος {{ s.year }}
            </p>
            <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt class="text-slate-500">Διαμέρισμα</dt>
                <dd class="font-medium text-slate-900">{{ s.unitLabel }}</dd>
              </div>
              <div>
                <dt class="text-slate-500">Ιδιοκτήτης</dt>
                <dd class="font-medium text-slate-900">
                  {{ s.ownerName ?? '—' }}
                </dd>
              </div>
            </dl>
          </header>

          <table class="data-table">
            <thead>
              <tr>
                <th>Μήνας</th>
                <th>Περιγραφή</th>
                <th class="text-right">Χρέωση</th>
                <th class="text-right">Πληρωμή</th>
              </tr>
            </thead>
            <tbody>
              @for (row of s.rows; track $index) {
                <tr>
                  <td class="whitespace-nowrap font-medium">
                    {{ monthLabelOf(row.periodYearMonth) }}
                  </td>
                  <td>{{ row.description }}</td>
                  <td class="whitespace-nowrap text-right">
                    {{ euros(row.invoicedCents) }}
                  </td>
                  <td class="whitespace-nowrap text-right">
                    {{ euros(row.paidCents) }}
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="py-8 text-center text-slate-500">
                    Δεν υπάρχουν κινήσεις για το έτος {{ s.year }}.
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="font-semibold text-slate-900">
                <td colspan="2">ΣΥΝΟΛΟ</td>
                <td class="whitespace-nowrap text-right">
                  {{ euros(s.totals.invoicedCents) }}
                </td>
                <td class="whitespace-nowrap text-right">
                  {{ euros(s.totals.paidCents) }}
                </td>
              </tr>
              <tr class="font-semibold text-slate-900">
                <td colspan="2">Υπόλοιπο</td>
                <td
                  colspan="2"
                  class="whitespace-nowrap text-right"
                  [class.text-red-700]="s.totals.balanceCents > 0"
                  [class.text-green-700]="s.totals.balanceCents === 0"
                >
                  {{ euros(s.totals.balanceCents) }}
                </td>
              </tr>
            </tfoot>
          </table>

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
export class ResidentStatementPage implements OnInit, OnDestroy {
  private readonly statementsApi = inject(StatementsApiService);
  private readonly brandingApi = inject(BrandingApiService);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);

  protected readonly euros = formatEuros;

  private readonly currentYear = new Date().getFullYear();
  protected readonly years = [
    this.currentYear,
    this.currentYear - 1,
    this.currentYear - 2,
  ];

  protected readonly year = signal(String(this.currentYear));
  protected readonly statement = signal<ResidentStatement | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly printedAt = signal('');
  /** White-label branding; silently falls back to defaults on any error. */
  protected readonly branding = signal<PublicBrandingDto | null>(null);

  ngOnInit(): void {
    this.document.body.classList.add('app-print-statement');
    this.load();
    const buildingId = this.auth.currentUser()?.buildingId;
    if (buildingId) {
      this.brandingApi
        .getPublic(buildingId)
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
    this.loading.set(true);
    this.error.set(false);
    this.statementsApi
      .mine(this.year())
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((statement) => {
        this.statement.set(statement);
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

  protected printSheet(): void {
    window.print();
  }
}
