import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { EMPTY, catchError, of } from 'rxjs';
import type {
  PlatformInvoiceDto,
  PlatformInvoiceStatus,
} from '@org/shared/lib/self-billing';
import type { SubscriptionDto } from '@org/shared';
import { TIER_PRICES_CENTS } from '@org/shared';
import { SelfBillingApiService } from '../../core/api/self-billing-api.service';
import { SubscriptionsApiService } from '../../core/api/subscriptions-api.service';
import { ToastService } from '../../ui/toast.service';
import { formatEuros } from '../../ui/format';

const STATUS_LABELS: Record<PlatformInvoiceStatus, string> = {
  ISSUED: 'Εκδοθέν',
  PAID: 'Εξοφλημένο',
  VOID: 'Ακυρωμένο',
};

const TIER_LABELS: Record<string, string> = {
  BASIC: 'Basic',
  PRO: 'Pro',
  PREMIUM: 'Premium',
};

/** `2026-08` / `2026-08-ADJ-2` → `8/2026` (+ προσαρμογή) (pure). */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-');
  const suffix = period.includes('-ADJ') ? ' (προσαρμογή)' : '';
  return `${month}/${year}${suffix}`;
}

@Component({
  selector: 'app-admin-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @media print {
      ::ng-deep body.app-print-billing app-layout header,
      ::ng-deep body.app-print-billing app-layout aside {
        display: none !important;
      }
      ::ng-deep body.app-print-billing app-layout main {
        margin-left: 0 !important;
        padding: 0 !important;
      }
    }
  `,
  template: `
    <div class="print:hidden mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-slate-900">Χρέωση πλατφόρμας</h1>
      <button type="button" class="btn btn-primary" (click)="print()">
        Εκτύπωση
      </button>
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης χρέωσης πλατφόρμας.
      </div>
    } @else {
      @if (sub(); as s) {
        <div class="card mb-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="card-title">Πακέτο &amp; τιμολόγηση</h2>
            <span class="text-sm text-slate-500">{{ s.units }} διαμερίσματα</span>
          </div>
          <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            <div>
              <dt class="text-slate-500">Πακέτο</dt>
              <dd class="font-medium text-slate-900">
                {{ tierLabel(s.tier) }}
                ({{ euros(TIER_PRICES_CENTS[s.tier]) }}/διαμ./μήνα)
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">Κύκλος</dt>
              <dd class="font-medium text-slate-900">
                {{ s.billingCycle === 'MONTHLY' ? 'Μηνιαίος' : 'Ετήσιος (−15%)' }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">Επόμενη μηνιαία αντιπαράβαλση</dt>
              <dd class="font-semibold text-slate-900">
                {{ euros(nextChargeCents()) }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">Κατάσταση συνδρομής</dt>
              <dd class="font-medium text-slate-900">{{ s.derivedStatus }}</dd>
            </div>
          </dl>
        </div>

        <div class="card print:hidden mb-6">
          <h2 class="card-title">Έκδοση μηνιαίου τιμολογίου</h2>
          <p class="mt-1 text-sm text-slate-600">
            Η έκδοση είναι ιδίωση ανά περίοδο· επαναλαμβανόμενη εκτέλεση για τον
            ίδιο μήνα δεν δημιουργεί νέο τιμολόγιο. Μηδενικά ποσά (δοκιμαστική
            περίοδος) εξοφλούνται αυτόματα.
          </p>
          <div class="mt-4 flex flex-wrap items-end gap-2">
            <label class="label !mb-0" for="billing-period">Περίοδος</label>
            <input
              id="billing-period"
              type="month"
              class="input !w-40"
              [value]="period()"
              (change)="onPeriodChange($event)"
            />
            <button
              type="button"
              class="btn btn-primary"
              (click)="runPeriod()"
              [disabled]="busy() || !period()"
            >
              Έκδοση για {{ periodLabel(period()) }}
            </button>
          </div>
        </div>
      }

      <div class="card">
        <h2 class="card-title">Τιμολόγια πλατφόρμας</h2>
        @if (invoices().length === 0) {
          <p class="py-8 text-center text-sm text-slate-500">
            Δεν έχουν εκδοθεί τιμολόγια πλατφόρμας ακόμη.
          </p>
        } @else {
          <table class="data-table mt-3">
            <thead>
              <tr>
                <th>Αριθμός</th>
                <th>Περίοδος</th>
                <th>Πακέτο</th>
                <th class="text-right">Διαμερίσματα</th>
                <th class="text-right">Ποσό</th>
                <th>Κατάσταση</th>
                <th>Έκδοση</th>
              </tr>
            </thead>
            <tbody>
              @for (invoice of invoices(); track invoice.id) {
                <tr>
                  <td class="whitespace-nowrap font-mono text-xs font-medium">
                    {{ invoice.number }}
                  </td>
                  <td class="whitespace-nowrap">
                    {{ periodLabel(invoice.period) }}
                  </td>
                  <td>{{ tierLabel(invoice.tier) }}</td>
                  <td class="text-right">{{ invoice.units }}</td>
                  <td class="whitespace-nowrap text-right font-medium">
                    {{ euros(invoice.amountCents) }}
                  </td>
                  <td class="whitespace-nowrap">
                    <span [class]="statusBadgeCls(invoice.status)">
                      {{ statusLabel(invoice.status) }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap">
                    {{ fmtDate(invoice.issuedAt) }}
                    @if (invoice.paidAt) {
                      <span class="text-slate-400">
                        · εξόφληση {{ fmtDate(invoice.paidAt) }}
                      </span>
                    }
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="font-semibold text-slate-900">
                <td colspan="4">ΣΥΝΟΛΟ</td>
                <td class="whitespace-nowrap text-right">
                  {{ euros(totalCents()) }}
                </td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        }
      </div>
    }
  `,
})
export class AdminBillingPage implements OnInit, OnDestroy {
  private readonly billingApi = inject(SelfBillingApiService);
  private readonly subscriptionsApi = inject(SubscriptionsApiService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  protected readonly euros = formatEuros;
  protected readonly periodLabel = periodLabel;
  protected readonly TIER_PRICES_CENTS = TIER_PRICES_CENTS;

  protected readonly now = new Date();
  protected readonly period = signal(
    `${this.now.getFullYear()}-${String(this.now.getMonth() + 1).padStart(2, '0')}`,
  );
  protected readonly sub = signal<SubscriptionDto | null>(null);
  protected readonly invoices = signal<PlatformInvoiceDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly busy = signal(false);

  protected readonly totalCents = computed(() =>
    this.invoices().reduce((sum, invoice) => sum + invoice.amountCents, 0),
  );

  protected readonly nextChargeCents = computed(() => {
    const s = this.sub();
    if (!s) return 0;
    return TIER_PRICES_CENTS[s.tier] * s.units;
  });

  ngOnInit(): void {
    this.document.body.classList.add('app-print-billing');
    this.reload();
  }

  ngOnDestroy(): void {
    this.document.body.classList.remove('app-print-billing');
  }

  protected reload(): void {
    this.loading.set(true);
    this.error.set(false);
    this.subscriptionsApi
      .get()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return of(null);
        }),
      )
      .subscribe((sub) => {
        this.sub.set(sub ?? null);
        if (!sub) return;
        this.billingApi
          .list(sub.buildingId)
          .pipe(
            catchError(() => {
              this.error.set(true);
              this.loading.set(false);
              return EMPTY;
            }),
          )
          .subscribe((invoices) => {
            this.invoices.set(invoices);
            this.loading.set(false);
          });
      });
  }

  protected onPeriodChange(event: Event): void {
    this.period.set((event.target as HTMLInputElement).value);
  }

  protected runPeriod(): void {
    const buildingId = this.sub()?.buildingId;
    const period = this.period();
    if (!buildingId || !period || this.busy()) return;
    this.busy.set(true);
    this.billingApi
      .runPeriod(buildingId, period)
      .pipe(
        catchError(() => {
          this.toast.error('Η έκδοση τιμολογίου απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.busy.set(false);
        if (result.created) {
          this.toast.success(`Εκδόθηκε το ${result.invoice?.number}.`);
        } else {
          this.toast.info(
            `Υπάρχει ήδη τιμολόγιο για την περίοδο (${result.invoice?.number}).`,
          );
        }
        this.reload();
      });
  }

  protected print(): void {
    window.print();
  }

  protected tierLabel(tier: string): string {
    return TIER_LABELS[tier] ?? tier;
  }

  protected statusLabel(status: PlatformInvoiceStatus): string {
    return STATUS_LABELS[status];
  }

  protected statusBadgeCls(status: PlatformInvoiceStatus): string {
    switch (status) {
      case 'PAID':
        return 'badge bg-green-100 text-green-800';
      case 'VOID':
        return 'badge bg-slate-100 text-slate-600 line-through';
      default:
        return 'badge bg-amber-100 text-amber-800';
    }
  }

  protected fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }
}
