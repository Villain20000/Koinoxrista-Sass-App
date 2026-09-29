import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import type {
  BankImportPreviewResponse,
  PendingPaymentOptionDto,
} from '@org/shared';
import { BankImportApiService } from '../../core/api/bank-import-api.service';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { formatEuros } from '../../ui/format';

type Confidence = 'high' | 'medium' | 'low';

/** Greek badge label for a match confidence (pure). */
export function confidenceLabel(confidence: Confidence): string {
  switch (confidence) {
    case 'high':
      return 'Υψηλή';
    case 'medium':
      return 'Μεσαία';
    default:
      return 'Χαμηλή';
  }
}

/** Tailwind badge classes per confidence (pure). */
export function confidenceCls(confidence: Confidence): string {
  switch (confidence) {
    case 'high':
      return 'bg-emerald-100 text-emerald-700';
    case 'medium':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-slate-200 text-slate-600';
  }
}

@Component({
  selector: 'app-admin-bank-import',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Κινήσεις τράπεζας</h1>

    <div class="card mb-6 grid gap-4">
      <p class="text-sm text-slate-500">
        Επικολλήστε το CSV κίνησης του λογαριασμού της πολυκατοικίας. Οι
        θετικές εισπράξεις ταιριάζονται αυτόματα με εκκρεμείς πληρωμές
        (IRIS).
      </p>
      <textarea
        class="input min-h-40 font-mono text-xs"
        placeholder="Ημερομηνία;Ποσό;Αιτιολογία…"
        [ngModel]="csv()"
        (ngModelChange)="csv.set($event)"
      ></textarea>
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          class="btn btn-primary"
          (click)="runPreview()"
          [disabled]="busy() || csv().trim().length === 0"
        >
          Προεπισκόπηση
        </button>
      </div>
    </div>

    @if (message()) {
      <div class="card mb-6 bg-emerald-50 text-sm text-emerald-700">
        {{ message() }}
      </div>
    }

    @if (error()) {
      <div class="card mb-6 border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία επεξεργασίας του CSV. Δοκιμάστε ξανά.
      </div>
    }

    @if (preview(); as p) {
      @if (p.rows.length === 0) {
        <div class="card text-sm text-slate-500">
          Δεν βρέθηκαν θετικές εισπράξεις στο αρχείο.
        </div>
      } @else {
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold text-slate-900">
            Κινήσεις ({{ p.rows.length }})
          </h2>
          <button
            type="button"
            class="btn btn-primary"
            (click)="applyMatches()"
            [disabled]="busy() || applyableCount() === 0"
          >
            Καταχώρηση ({{ applyableCount() }})
          </button>
        </div>

        <div class="card overflow-x-auto p-0">
          <table class="w-full text-left text-sm">
            <thead class="text-xs uppercase text-slate-400">
              <tr>
                <th class="px-4 py-3">Ενσωμάτωση</th>
                <th class="px-4 py-3">Ημερομηνία</th>
                <th class="px-4 py-3">Αιτιολογία</th>
                <th class="px-4 py-3 text-right">Ποσό</th>
                <th class="px-4 py-3">Πληρωμή</th>
                <th class="px-4 py-3">Βεβαιότητα</th>
              </tr>
            </thead>
            <tbody>
              @for (r of p.rows; track $index; let i = $index) {
                <tr class="border-t border-slate-100">
                  <td class="px-4 py-2">
                    <input
                      type="checkbox"
                      [disabled]="!selection(i)"
                      [ngModel]="checked()[i] ?? false"
                      (ngModelChange)="setChecked(i, $event)"
                    />
                  </td>
                  <td class="px-4 py-2 whitespace-nowrap">{{ r.dateIso }}</td>
                  <td class="max-w-64 truncate px-4 py-2" [title]="r.reference">
                    {{ r.reference || '—' }}
                  </td>
                  <td class="px-4 py-2 text-right font-medium whitespace-nowrap">
                    {{ euros(r.amountCents) }}
                  </td>
                  <td class="px-4 py-2">
                    <select
                      class="input !w-72 !py-1 text-xs"
                      [ngModel]="selection(i)"
                      (ngModelChange)="setSelection(i, $event)"
                    >
                      <option value="">— Χωρίς αντιστοίχιση —</option>
                      @for (opt of pendingOptions(); track opt.paymentId) {
                        <option [value]="opt.paymentId">
                          {{ optionLabel(opt) }}
                        </option>
                      }
                    </select>
                  </td>
                  <td class="px-4 py-2">
                    @if (suggestionFor(i); as s) {
                      <span
                        class="badge"
                        [class]="confidenceCls(s.confidence)"
                      >{{ confidenceLabel(s.confidence) }}</span>
                    } @else {
                      <span class="text-slate-300">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
})
export class AdminBankImportPage implements OnInit {
  private readonly bankImportApi = inject(BankImportApiService);
  private readonly buildingsApi = inject(BuildingsApiService);

  protected readonly euros = formatEuros;
  protected readonly confidenceLabel = confidenceLabel;
  protected readonly confidenceCls = confidenceCls;

  protected readonly csv = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly preview = signal<BankImportPreviewResponse | null>(null);

  /** rowIndex → selected paymentId. */
  protected readonly selections = signal<Record<number, string>>({});
  /** rowIndex → include in next apply batch. */
  protected readonly checked = signal<Record<number, boolean>>({});

  private buildingId: string | null = null;

  protected readonly pendingOptions = computed<PendingPaymentOptionDto[]>(
    () => this.preview()?.pending ?? [],
  );

  protected readonly applyableCount = computed(() => {
    const checkedMap = this.checked();
    const selectionMap = this.selections();
    return Object.entries(checkedMap).filter(
      ([rowIndex, isChecked]) => isChecked && selectionMap[Number(rowIndex)],
    ).length;
  });

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set(true);
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
      });
  }

  protected selection(rowIndex: number): string {
    return this.selections()[rowIndex] ?? '';
  }

  protected setSelection(rowIndex: number, paymentId: string): void {
    this.selections.update((map) => ({ ...map, [rowIndex]: paymentId }));
    if (!paymentId) {
      this.setChecked(rowIndex, false);
    }
  }

  protected setChecked(rowIndex: number, value: boolean): void {
    this.checked.update((map) => ({ ...map, [rowIndex]: value }));
  }

  protected suggestionFor(rowIndex: number) {
    return this.preview()?.suggestions.find((s) => s.rowIndex === rowIndex);
  }

  protected optionLabel(opt: PendingPaymentOptionDto): string {
    return `${opt.unitLabel} · ${opt.invoicePeriodYearMonth} · ${this.euros(opt.amountCents)}`;
  }

  protected runPreview(): void {
    const csv = this.csv();
    if (!this.buildingId || this.busy() || csv.trim().length === 0) return;
    this.error.set(false);
    this.message.set(null);
    this.doPreview(csv);
  }

  private doPreview(csv: string): void {
    const buildingId = this.buildingId;
    if (!buildingId || this.busy()) return;
    this.busy.set(true);
    this.error.set(false);
    this.bankImportApi
      .preview(buildingId, csv)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((p) => {
        this.preview.set(p);
        const selections: Record<number, string> = {};
        const checkedMap: Record<number, boolean> = {};
        for (const s of p.suggestions) {
          if (s.paymentId) {
            selections[s.rowIndex] = s.paymentId;
            checkedMap[s.rowIndex] = true;
          }
        }
        this.selections.set(selections);
        this.checked.set(checkedMap);
        this.busy.set(false);
      });
  }

  protected applyMatches(): void {
    const buildingId = this.buildingId;
    if (!buildingId || this.busy()) return;
    const checkedMap = this.checked();
    const matches = Object.keys(checkedMap)
      .map(Number)
      .filter((rowIndex) => checkedMap[rowIndex])
      .map((rowIndex) => ({ rowIndex, paymentId: this.selection(rowIndex) }))
      .filter((match) => match.paymentId !== '');
    if (matches.length === 0) return;

    this.busy.set(true);
    this.error.set(false);
    this.bankImportApi
      .apply(buildingId, { csv: this.csv(), matches })
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ applied, skipped }) => {
        this.message.set(
          skipped > 0
            ? `Καταχωρήθηκαν ${applied} πληρωμές, παραλείφθηκαν ${skipped}.`
            : `Καταχωρήθηκαν ${applied} πληρωμές.`,
        );
        this.doPreview(this.csv());
      });
  }
}
