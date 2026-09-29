import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EMPTY, catchError, filter } from 'rxjs';
import { Invoice, formatPeriod, isValidPeriod } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { InvoicesApiService } from '../../core/api/invoices-api.service';
import { UnitsApiService } from '../../core/api/units-api.service';
import { ToastService } from '../../ui/toast.service';
import { StatusBadgeComponent } from '../../ui/status-badge.component';
import { formatEuros } from '../../ui/format';

@Component({
  selector: 'app-admin-run',
  imports: [ReactiveFormsModule, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Μηνιαία εκκαθάριση</h1>

    <div class="card mb-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div>
          <label class="label" for="period">Περίοδος</label>
          <input id="period" type="month" class="input" [formControl]="periodCtrl" />
          @if (!isValidPeriod(periodCtrl.value)) {
            <p class="field-error">Δώστε έγκυρη περίοδο (YYYY-MM).</p>
          }
        </div>
        <button
          type="button"
          class="btn btn-primary"
          (click)="run()"
          [disabled]="running() || !isValidPeriod(periodCtrl.value)"
        >
          {{ running() ? 'Εκτέλεση…' : 'Εκτέλεση εκκαθάρισης' }}
        </button>
      </div>
      <p class="mt-3 text-xs text-slate-500">
        Η εκκαθάριση υπολογίζει τα κοινόχρηστα κάθε διαμερίσματος για την
        επιλεγμένη περίοδο, με βάση τις κατηγορίες και τα έξοδα του μήνα.
      </p>
    </div>

    @if (loadError()) {
      <div class="card mb-6 border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης κοινοχρήστων.
      </div>
    }

    @if (invoices(); as list) {
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Διαμέρισμα</th>
              <th>Περίοδος</th>
              <th>Σύνολο</th>
              <th>Κατάσταση</th>
            </tr>
          </thead>
          <tbody>
            @for (invoice of list; track invoice.id) {
              <tr>
                <td class="font-medium">{{ unitLabel(invoice.unitId) }}</td>
                <td>{{ invoice.periodYearMonth }}</td>
                <td>{{ euros(invoice.totalCents) }}</td>
                <td><app-status-badge [status]="invoice.status" /></td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="py-8 text-center text-slate-500">
                  Δεν βρέθηκαν κοινόχρηστα για την περίοδο {{ periodCtrl.value }}.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AdminRunPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly invoicesApi = inject(InvoicesApiService);
  private readonly toast = inject(ToastService);

  protected readonly isValidPeriod = isValidPeriod;
  protected readonly euros = formatEuros;

  protected readonly periodCtrl = new FormControl(formatPeriod(new Date()), {
    nonNullable: true,
  });

  protected readonly invoices = signal<Invoice[] | null>(null);
  protected readonly running = signal(false);
  protected readonly loadError = signal(false);
  protected readonly unitLabels = signal<Record<string, string>>({});

  private buildingId: string | null = null;

  constructor() {
    this.periodCtrl.valueChanges
      .pipe(filter(isValidPeriod), takeUntilDestroyed())
      .subscribe((period) => this.loadInvoices(period));
  }

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.unitsApi
          .list(building.id)
          .pipe(catchError(() => EMPTY))
          .subscribe((units) => {
            const labels: Record<string, string> = {};
            for (const unit of units) labels[unit.id] = unit.label;
            this.unitLabels.set(labels);
          });
        this.loadInvoices(this.periodCtrl.value);
      });
  }

  protected run(): void {
    const buildingId = this.buildingId;
    const period = this.periodCtrl.value;
    if (!buildingId || !isValidPeriod(period) || this.running()) return;
    this.running.set(true);
    this.invoicesApi.run(buildingId, { periodYearMonth: period }).subscribe({
      next: (invoices) => {
        this.invoices.set(invoices);
        this.toast.success('Η εκκαθάριση ολοκληρώθηκε.');
        this.running.set(false);
      },
      error: () => {
        this.toast.error('Η εκκαθάριση απέτυχε. Ελέγξτε τα έξοδα της περιόδου.');
        this.running.set(false);
      },
    });
  }

  protected unitLabel(unitId: string): string {
    return this.unitLabels()[unitId] ?? 'Διαμέρισμα';
  }

  private loadInvoices(period: string): void {
    if (!this.buildingId || !isValidPeriod(period)) return;
    this.loadError.set(false);
    this.invoicesApi
      .list(this.buildingId, period)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((invoices) => this.invoices.set(invoices));
  }
}
