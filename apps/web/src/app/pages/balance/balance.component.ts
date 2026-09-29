import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, catchError } from 'rxjs';
import { Invoice, PaymentOrder } from '@org/shared';
import {
  InvoiceDetailView,
  PaymentsApiService,
} from '../../core/api/payments-api.service';
import { InvoicesApiService } from '../../core/api/invoices-api.service';
import { GdprApiService } from '../../core/api/gdpr-api.service';
import { downloadBlob } from '../../core/api/http-download';
import { AuthService } from '../../core/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { StatusBadgeComponent } from '../../ui/status-badge.component';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import {
  QrCodeComponent,
  buildIrisNote,
} from '../../ui/qr-code.component';
import {
  HelpTourComponent,
  HelpTourStep,
} from '../../ui/help-tour.component';
import { ToastService } from '../../ui/toast.service';
import { formatEuros, shortRef } from '../../ui/format';
import { TourService } from '../../core/tour.service';

/** Detects the sandbox/mock checkout flow (pure). */
export function isMockCheckout(checkoutUrl: string): boolean {
  return checkoutUrl.includes('mockOrder');
}

@Component({
  selector: 'app-balance',
  imports: [StatusBadgeComponent, ConfirmModalComponent, QrCodeComponent, RouterLink, HelpTourComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-slate-900">Υπόλοιπό μου</h1>
      <a routerLink="/balance/statement" class="btn btn-secondary">
        Ετήσιο αποδεικτικό
      </a>
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης κοινοχρήστων. Δοκιμάστε να ανανεώσετε τη σελίδα.
      </div>
    } @else {
      <div class="card mb-6 max-w-sm">
        <p class="text-sm text-slate-500">Ανεξόφλητο υπόλοιπο</p>
        <p
          class="stat-value mt-1"
          [class.text-red-600]="outstanding() > 0"
          [class.text-green-700]="outstanding() === 0"
        >
          {{ euros(outstanding()) }}
        </p>
      </div>

      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Περίοδος</th>
              <th>Σύνολο</th>
              <th>Πληρώθηκε</th>
              <th>Κατάσταση</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (invoice of invoices(); track invoice.id) {
              <tr>
                <td class="font-medium">{{ invoice.periodYearMonth }}</td>
                <td>{{ euros(invoice.totalCents) }}</td>
                <td>{{ euros(invoice.paidCents) }}</td>
                <td><app-status-badge [status]="invoice.status" /></td>
                <td class="whitespace-nowrap text-right">
                  <button
                    type="button"
                    class="btn btn-secondary !px-2 !py-1 text-xs"
                    (click)="openHistory(invoice.id)"
                  >
                    Ιστορικό
                  </button>
                  @if (isPayable(invoice)) {
                    <button
                      type="button"
                      class="btn btn-primary ml-1 !px-2 !py-1 text-xs"
                      [disabled]="payingId() === invoice.id"
                      (click)="pay(invoice)"
                    >
                      {{ payingId() === invoice.id ? 'Αναμονή…' : 'Πληρωμή' }}
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="py-8 text-center text-slate-500">
                  Δεν υπάρχουν κοινόχρηστα για εσάς ακόμη.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (activeCheckoutUrl(); as url) {
        <div class="card mt-6">
          <details>
            <summary
              class="cursor-pointer select-none text-sm font-semibold text-slate-900"
            >
              Ή πληρώστε με IRIS
            </summary>
            <div
              class="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center"
            >
              <app-qr-code [value]="url" [size]="160" />
              <div class="min-w-0 flex-1">
                <p class="mb-1 text-xs text-slate-500">
                  Σημείωμα πληρωμής: {{ irisNote() }}
                </p>
                <a
                  [href]="url"
                  target="_blank"
                  rel="noopener"
                  [title]="url"
                  class="block max-w-xs truncate text-sm text-blue-700 underline hover:text-blue-900"
                >
                  {{ url }}
                </a>
                <div class="mt-3 flex flex-wrap gap-2">
                  <a
                    [href]="url"
                    target="_blank"
                    rel="noopener"
                    class="btn btn-primary"
                  >
                    Πληρωμή με κάρτα
                  </a>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    (click)="copyCheckoutLink()"
                  >
                    Αντιγραφή συνδέσμου
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="loading()"
                    (click)="loadInvoices()"
                  >
                    Ανανέωση κατάστασης
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>
      }
    }

    @if (detail(); as d) {
      <div class="fixed inset-0 z-50 flex justify-end">
        <button
          type="button"
          class="absolute inset-0 cursor-default bg-slate-900/40"
          (click)="closeHistory()"
          aria-label="Κλείσιμο ιστορικού"
        ></button>
        <aside
          class="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-xl"
        >
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-base font-semibold text-slate-900">
              Ιστορικό πληρωμών — {{ d.periodYearMonth }}
            </h2>
            <button
              type="button"
              class="btn btn-secondary !px-2 !py-1 text-xs"
              (click)="closeHistory()"
            >
              &times;
            </button>
          </div>

          <dl class="mb-4 grid grid-cols-2 gap-2 text-sm">
            <dt class="text-slate-500">Σύνολο</dt>
            <dd>{{ euros(d.totalCents) }}</dd>
            <dt class="text-slate-500">Πληρώθηκε</dt>
            <dd>{{ euros(d.paidCents) }}</dd>
            <dt class="text-slate-500">Κατάσταση</dt>
            <dd><app-status-badge [status]="d.status" /></dd>
          </dl>

          <a
            [href]="receiptUrl(d.id)"
            target="_blank"
            rel="noopener"
            class="btn btn-secondary mb-4 w-full"
          >
            Απόδειξη
          </a>

          <h3 class="card-title">Πληρωμές</h3>
          @if (d.payments.length > 0) {
            <ul class="flex flex-col gap-2">
              @for (payment of d.payments; track payment.id) {
                <li
                  class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <div>
                    <span class="badge mr-2" [class]="methodCls(payment.method)">
                      {{ methodLabel(payment.method) }}
                    </span>
                    <span class="text-xs text-slate-500">{{ short(payment.pspRef) }}</span>
                  </div>
                  <div class="text-right">
                    <p class="font-medium">{{ euros(payment.amountCents) }}</p>
                    <p class="text-xs text-slate-500">{{ payment.status }}</p>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-slate-500">Δεν υπάρχουν καταγεγραμμένες πληρωμές.</p>
          }
        </aside>
      </div>
    }

    <div class="card mt-6">
      <h2 class="card-title">Προσωπικά δεδομένα (GDPR)</h2>
      <p class="text-sm text-slate-600">
        Κατεβάστε αντίγραφο των δεδομένων σας ή ανωνυμοποιήστε τον λογαριασμό
        σας. Τα οικονομικά και ψηφοφορικά αρχεία διατηρούνται ανώνυμα για
        νομικούς λόγους.
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-secondary"
          (click)="downloadExport()"
          [disabled]="exporting()"
        >
          {{ exporting() ? 'Λήψη…' : 'Λήψη εξαγωγής δεδομένων' }}
        </button>
        <button
          type="button"
          class="btn btn-danger"
          (click)="confirmingDelete.set(true)"
          [disabled]="deleting()"
        >
          Διαγραφή λογαριασμού
        </button>
      </div>
      <label class="mt-3 block text-xs text-slate-500">
        Πληκτρολογήστε DELETE για επιβεβαίωση διαγραφής
        <input
          type="text"
          class="input mt-1 w-full max-w-xs"
          [value]="confirmText()"
          (input)="onConfirmInput($event)"
          placeholder="DELETE"
          autocomplete="off"
        />
      </label>
    </div>

    @if (confirmingDelete()) {
      <app-confirm-modal
        title="Διαγραφή λογαριασμού"
        message="Ο λογαριασμός σας θα ανωνυμοποιηθεί οριστικά και θα αποσυνδεθείτε. Συνέχεια;"
        [danger]="true"
        confirmLabel="Οριστική διαγραφή"
        (confirmed)="eraseAccount()"
        (cancelled)="confirmingDelete.set(false)"
      />
    }

    @if (showTour()) {
      <app-help-tour
        tourId="balance"
        [steps]="tourSteps"
        (closed)="showTour.set(false)"
      />
    }
  `,
})
export class BalancePage implements OnInit {
  private readonly invoicesApi = inject(InvoicesApiService);
  private readonly paymentsApi = inject(PaymentsApiService);
  private readonly gdprApi = inject(GdprApiService);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly tour = inject(TourService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly euros = formatEuros;
  protected readonly short = shortRef;
  protected readonly methodLabel = this.paymentsApi.methodLabel;

  /** Ξενάγηση πρώτης χρήσης (παίζεται μία φορά ανά συσκευή). */
  protected readonly showTour = signal(this.tour.launch('balance'));
  protected readonly tourSteps: HelpTourStep[] = [
    {
      title: 'Τα κοινόχρηστά σας',
      body: 'Εδώ βλέπετε το ανεξόφλητο υπόλοιπο και όλα τα κοινοχρήστα σας.',
      selector: 'table.data-table',
    },
    {
      title: 'Πληρωμή online',
      body: 'Πατήστε «Πληρωμή» για κάρτα ή IRIS. Η απόδειξη κατεβαίνει από το ιστορικό.',
      selector: 'table.data-table',
    },
  ];

  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly payingId = signal<string | null>(null);
  protected readonly detail = signal<InvoiceDetailView | null>(null);
  protected readonly exporting = signal(false);
  protected readonly deleting = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly confirmText = signal('');
  /** Checkout order awaiting payment (drives the IRIS section). */
  protected readonly activeOrder = signal<PaymentOrder | null>(null);

  /** Active checkout URL, hidden once the invoice is no longer payable. */
  protected readonly activeCheckoutUrl = computed(() => {
    const order = this.activeOrder();
    if (!order) return null;
    const invoice = this.invoices().find((i) => i.id === order.invoiceId);
    return invoice && this.isPayable(invoice) ? order.checkoutUrl : null;
  });

  protected readonly irisNote = computed(() =>
    buildIrisNote(this.activeOrder()?.orderCode ?? ''),
  );

  /** Sum of unpaid remainders (total − paid) for open invoices. */
  protected readonly outstanding = () =>
    this.invoices().reduce(
      (sum, invoice) =>
        invoice.status === 'PAID' || invoice.status === 'REFUNDED'
          ? sum
          : sum + Math.max(0, invoice.totalCents - invoice.paidCents),
      0,
    );

  protected isPayable(invoice: Invoice): boolean {
    return (
      invoice.status !== 'PAID' &&
      invoice.status !== 'REFUNDED' &&
      invoice.totalCents - invoice.paidCents > 0
    );
  }

  ngOnInit(): void {
    this.loadInvoices();
  }

  protected loadInvoices(): void {
    this.loading.set(true);
    this.error.set(false);
    this.invoicesApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set(true);
          return EMPTY;
        }),
      )
      .subscribe((invoices) => {
        this.invoices.set(invoices);
        this.loading.set(false);
      });
  }

  protected openHistory(invoiceId: string): void {
    this.paymentsApi
      .detail(invoiceId)
      .pipe(
        catchError(() => {
          this.toast.error('Η φόρτωση του ιστορικού απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe((detail) => this.detail.set(detail));
  }

  protected closeHistory(): void {
    this.detail.set(null);
  }

  protected receiptUrl(invoiceId: string): string {
    return this.paymentsApi.receiptUrl(invoiceId);
  }

  protected methodCls(method: string | null | undefined): string {
    return method === 'IRIS' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700';
  }

  protected pay(invoice: Invoice): void {
    if (this.payingId()) return;
    this.analytics.capture('invoice_pay_started', { invoiceId: invoice.id });
    this.payingId.set(invoice.id);
    this.paymentsApi
      .pay(invoice.id)
      .pipe(
        catchError(() => {
          this.toast.error('Η έναρξη πληρωμής απέτυχε.');
          this.payingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(({ order }) => {
        this.payingId.set(null);
        this.activeOrder.set(order);
        if (isMockCheckout(order.checkoutUrl)) {
          this.toast.info('Δοκιμαστική πληρωμή (sandbox).', {
            link: { url: order.checkoutUrl, label: 'Άνοιγμα σε νέα καρτέλα' },
          });
        } else {
          this.toast.info(
            'Η εντολή πληρωμής δημιουργήθηκε. Επιλέξτε τρόπο πληρωμής.',
          );
        }
      });
  }

  protected async copyCheckoutLink(): Promise<void> {
    const url = this.activeCheckoutUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Ο σύνδεσμος αντιγράφηκε.');
    } catch {
      this.toast.error('Η αντιγραφή του συνδέσμου απέτυχε.');
    }
  }

  protected onConfirmInput(event: Event): void {
    this.confirmText.set((event.target as HTMLInputElement).value);
  }

  protected downloadExport(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.gdprApi
      .download()
      .pipe(
        catchError(() => {
          this.toast.error('Η λήψη της εξαγωγής απέτυχε.');
          this.exporting.set(false);
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        downloadBlob(blob, 'gdpr-export.json');
        this.exporting.set(false);
      });
  }

  protected eraseAccount(): void {
    this.confirmingDelete.set(false);
    if (this.deleting()) return;
    if (this.confirmText().trim() !== 'DELETE') {
      this.toast.error('Πληκτρολογήστε DELETE για επιβεβαίωση.');
      return;
    }
    this.deleting.set(true);
    this.gdprApi
      .deleteMe('DELETE')
      .pipe(
        catchError(() => {
          this.toast.error('Η διαγραφή του λογαριασμού απέτυχε.');
          this.deleting.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.info('Ο λογαριασμός σας ανωνυμοποιήθηκε.');
        this.auth.logout();
        void this.router.navigateByUrl('/login');
      });
  }
}
