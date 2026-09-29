import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EMPTY, catchError } from 'rxjs';
import { ArrearsReport, ArrearsRow } from '@org/shared';
import {
  BuildingsApiService,
  ReminderPreview,
} from '../../core/api/buildings-api.service';
import { downloadBlob } from '../../core/api/http-download';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import { ToastService } from '../../ui/toast.service';
import { formatEuros } from '../../ui/format';

/** Aggregated stats for the arrears header (pure). */
export function arrearsSummary(rows: ArrearsRow[]): {
  totalOutstandingCents: number;
  currentCount: number;
  b30Count: number;
  b60Count: number;
  b90PlusCount: number;
} {
  let totalOutstandingCents = 0;
  let currentCount = 0;
  let b30Count = 0;
  let b60Count = 0;
  let b90PlusCount = 0;
  for (const row of rows) {
    totalOutstandingCents += row.outstandingCents;
    if (row.bucketCurrentCents > 0) currentCount++;
    if (row.bucket30Cents > 0) b30Count++;
    if (row.bucket60Cents > 0) b60Count++;
    if (row.bucket90PlusCents > 0) b90PlusCount++;
  }
  return { totalOutstandingCents, currentCount, b30Count, b60Count, b90PlusCount };
}

/** Classes for a bucket cell, colored when there is an aging amount (pure). */
export function bucketCls(cents: number): string {
  return cents > 0 ? 'font-semibold text-red-700' : 'text-slate-400';
}

@Component({
  selector: 'app-admin-arrears',
  imports: [ConfirmModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-slate-900">Χρεώστες</h1>
      <div class="flex flex-wrap items-end gap-2">
        <button
          type="button"
          class="btn btn-primary"
          (click)="openReminderPreview()"
          [disabled]="busy()"
        >
          Υπενθύμιση
        </button>
        <div class="flex items-end gap-2">
          <div>
            <label class="label !mb-1 text-xs" for="ledgerYear">Έτος</label>
            <input
              id="ledgerYear"
              type="number"
              class="input !w-24"
              min="2000"
              max="2100"
              [value]="ledgerYear()"
              (change)="onYearChange($event)"
            />
          </div>
          <button
            type="button"
            class="btn btn-secondary"
            (click)="exportLedgerCsv()"
            [disabled]="busy()"
          >
            Εξαγωγή CSV καθαρότητας
          </button>
        </div>
        <button
          type="button"
          class="btn btn-secondary"
          (click)="exportArrearsCsv()"
          [disabled]="busy()"
        >
          Εξαγωγή CSV χρεών
        </button>
      </div>
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης αναφοράς χρεών.
      </div>
    } @else {
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div class="card">
          <p class="text-sm text-slate-500">Συνολικό ανεξόφλητο</p>
          <p class="stat-value mt-1 text-red-700">
            {{ euros(summary().totalOutstandingCents) }}
          </p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Ενεργά (0–30)</p>
          <p class="stat-value mt-1">{{ summary().currentCount }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">30–60 ημερών</p>
          <p class="stat-value mt-1">{{ summary().b30Count }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">60–90 ημερών</p>
          <p class="stat-value mt-1">{{ summary().b60Count }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">90+ ημερών</p>
          <p class="stat-value mt-1 text-red-700">{{ summary().b90PlusCount }}</p>
        </div>
      </div>

      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Διαμέρισμα</th>
              <th>Ιδιοκτήτες</th>
              <th>Ανεξόφλητο</th>
              <th>Ενεργό</th>
              <th>30+</th>
              <th>60+</th>
              <th>90+</th>
              <th>Παλαιότερη ανεξόφλητη περίοδος</th>
            </tr>
          </thead>
          <tbody>
            @for (row of report()?.rows; track row.unitId) {
              <tr>
                <td class="font-medium">{{ row.unitLabel }}</td>
                <td>{{ ownerNames(row.ownerNames) }}</td>
                <td>{{ euros(row.outstandingCents) }}</td>
                <td [class]="bucketCls(row.bucketCurrentCents)">
                  {{ centsOrDash(row.bucketCurrentCents) }}
                </td>
                <td [class]="bucketCls(row.bucket30Cents)">
                  {{ centsOrDash(row.bucket30Cents) }}
                </td>
                <td [class]="bucketCls(row.bucket60Cents)">
                  {{ centsOrDash(row.bucket60Cents) }}
                </td>
                <td [class]="bucketCls(row.bucket90PlusCents)">
                  {{ centsOrDash(row.bucket90PlusCents) }}
                </td>
                <td>{{ row.oldestUnpaidPeriod ?? '—' }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="py-8 text-center text-slate-500">
                  Κανένα ανεξόφλητο υπόλοιπο.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (preview(); as p) {
      <app-confirm-modal
        title="Προεπισκόπηση υπενθύμισης"
        [message]="
          p.recipients.length > 0
            ? 'Θα σταλεί email υπενθύμιση σε ' + p.recipients.length + ' παραλήπτες.'
            : 'Δεν βρέθηκαν παραλήπτες με ανεξόφλητα.'
        "
        [body]="previewBody(p)"
        confirmLabel="Αποστολή"
        (confirmed)="sendReminders()"
        (cancelled)="preview.set(null)"
      />
    }
  `,
})
export class AdminArrearsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly toast = inject(ToastService);

  protected readonly euros = formatEuros;
  protected readonly bucketCls = bucketCls;

  protected readonly report = signal<ArrearsReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly busy = signal(false);
  protected readonly preview = signal<ReminderPreview | null>(null);
  protected readonly ledgerYear = signal(new Date().getFullYear());

  protected readonly summary = computed(() =>
    arrearsSummary(this.report()?.rows ?? []),
  );

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    this.buildingsApi
      .arrears(buildingId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((report) => {
        this.report.set(report);
        this.loading.set(false);
      });
  }

  protected openReminderPreview(): void {
    const buildingId = this.buildingId;
    if (!buildingId || this.busy()) return;
    this.busy.set(true);
    this.buildingsApi
      .previewReminders(buildingId)
      .pipe(
        catchError(() => {
          this.toast.error('Η προεπισκόπηση απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((preview) => {
        this.preview.set(preview);
        this.busy.set(false);
      });
  }

  protected previewBody(preview: ReminderPreview): string | null {
    if (!preview.recipients.length) return null;
    return `Προς: ${preview.recipients.join(', ')}\nΘέμα: ${preview.subject}`;
  }

  protected sendReminders(): void {
    const buildingId = this.buildingId;
    this.preview.set(null);
    if (!buildingId || this.busy()) return;
    this.busy.set(true);
    this.buildingsApi
      .sendReminders(buildingId)
      .pipe(
        catchError(() => {
          this.toast.error('Η αποστολή υπενθυμίσεων απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ sent }) => {
        this.toast.success(`Στάλθηκαν ${sent} υπενθυμίσεις.`);
        this.busy.set(false);
      });
  }

  protected onYearChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isInteger(value) && value >= 2000 && value <= 2100) {
      this.ledgerYear.set(value);
    }
  }

  protected exportLedgerCsv(): void {
    const buildingId = this.buildingId;
    if (!buildingId || this.busy()) return;
    this.busy.set(true);
    this.buildingsApi
      .ledgerCsv(buildingId, this.ledgerYear())
      .pipe(
        catchError(() => {
          this.toast.error('Η εξαγωγή καθαρότητας απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        downloadBlob(blob, `katharotita-${this.ledgerYear()}.csv`);
        this.toast.success('Η εξαγωγή ολοκληρώθηκε.');
        this.busy.set(false);
      });
  }

  protected exportArrearsCsv(): void {
    const buildingId = this.buildingId;
    if (!buildingId || this.busy()) return;
    this.busy.set(true);
    this.buildingsApi
      .arrearsCsv(buildingId)
      .pipe(
        catchError(() => {
          this.toast.error('Η εξαγωγή χρεών απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        downloadBlob(blob, 'xrewstes.csv');
        this.toast.success('Η εξαγωγή ολοκληρώθηκε.');
        this.busy.set(false);
      });
  }

  protected ownerNames(names: string[]): string {
    return names.length ? names.join(', ') : '—';
  }

  protected centsOrDash(cents: number): string {
    return cents > 0 ? this.euros(cents) : '—';
  }
}
