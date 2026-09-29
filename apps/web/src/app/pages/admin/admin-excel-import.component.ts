import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { EMPTY, catchError } from 'rxjs';
import type {
  UnitImportPreviewDto,
  UnitImportResultDto,
} from '@org/shared';
import type { UnitImportRowDto } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { ExcelImportApiService } from '../../core/api/excel-import-api.service';

/** Reads a file as base64 (data-URL payload) for the JSON upload body. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** True when the row carries validation problems (preview highlighting). */
export function rowHasErrors(row: UnitImportRowDto): boolean {
  return row.errors.length > 0;
}

@Component({
  selector: 'app-admin-excel-import',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">
      Εισαγωγή διαμερισμάτων από Excel/CSV
    </h1>

    <div class="card mb-6 grid gap-4">
      <p class="text-sm text-slate-500">
        Επιλέξτε αρχείο .xlsx ή .csv με τις στήλες Διαμέρισμα / Όροφος /
        Χιλιοστά / Καλοριφέρ / Email. Θα δείτε προεπισκόπηση με ελέγχους πριν
        την καταχώρηση στα υπάρχοντα διαμερίσματα.
      </p>
      <div>
        <label class="label" for="file">Αρχείο</label>
        <input
          id="file"
          type="file"
          class="input"
          accept=".csv,.txt,.xlsx,.xlsm"
          (change)="onFileSelected($event)"
        />
        @if (filename(); as name) {
          <p class="mt-1 text-xs text-slate-500">{{ name }}</p>
        }
      </div>
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          class="btn btn-primary"
          (click)="runPreview()"
          [disabled]="busy() || !hasFile()"
        >
          Προεπισκόπηση
        </button>
      </div>
    </div>

    @if (error()) {
      <div class="card mb-6 border-red-200 bg-red-50 text-sm text-red-700">
        {{ error() }}
      </div>
    }

    @if (result(); as r) {
      <div class="card mb-6 bg-emerald-50 text-sm text-emerald-700">
        Η εισαγωγή ολοκληρώθηκε: δημιουργήθηκαν {{ r.created }} και
        ενημερώθηκαν {{ r.updated }} διαμερίσματα.
      </div>
    }

    @if (preview(); as p) {
      @if (p.warnings.length > 0) {
        <div class="card mb-6 bg-amber-50 text-sm text-amber-700">
          @for (warning of p.warnings; track warning) {
            <p>{{ warning }}</p>
          }
        </div>
      }

      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold text-slate-900">
          Έγκυρες γραμμές: {{ p.validCount }} · Σφάλματα:
          {{ p.errorCount }} · Σύνολο χιλιοστών: {{ p.totalMillimes }}
        </h2>
        <button
          type="button"
          class="btn btn-primary"
          (click)="confirm()"
          [disabled]="busy() || p.validCount === 0"
        >
          Επιβεβαίωση καταχώρησης ({{ p.validCount }})
        </button>
      </div>

      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="text-xs uppercase text-slate-400">
            <tr>
              <th class="px-4 py-3">Διαμέρισμα</th>
              <th class="px-4 py-3">Όροφος</th>
              <th class="px-4 py-3 text-right">Χιλιοστά</th>
              <th class="px-4 py-3 text-right">Καλοριφέρ</th>
              <th class="px-4 py-3">Email</th>
              <th class="px-4 py-3">Σφάλματα</th>
            </tr>
          </thead>
          <tbody>
            @for (row of p.rows; track $index) {
              <tr
                class="border-t border-slate-100"
                [class.bg-red-50]="rowHasErrors(row)"
              >
                <td class="px-4 py-2 font-medium">
                  {{ row.label || '—' }}
                </td>
                <td class="px-4 py-2">{{ row.floor ?? '—' }}</td>
                <td class="px-4 py-2 text-right">{{ row.millimes ?? '—' }}</td>
                <td class="px-4 py-2 text-right">
                  {{ row.radiatorCount ?? '—' }}
                </td>
                <td class="max-w-48 truncate px-4 py-2" [title]="row.ownerEmail ?? ''">
                  {{ row.ownerEmail || '—' }}
                </td>
                <td class="px-4 py-2 text-red-600">
                  @for (message of row.errors; track message) {
                    <span class="block">{{ message }}</span>
                  }
                  @if (row.errors.length === 0) {
                    <span class="text-emerald-600">OK</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="py-8 text-center text-slate-500">
                  Δεν βρέθηκαν γραμμές στο αρχείο.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AdminExcelImportPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly excelImportApi = inject(ExcelImportApiService);

  protected readonly rowHasErrors = rowHasErrors;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly filename = signal<string | null>(null);
  protected readonly preview = signal<UnitImportPreviewDto | null>(null);
  protected readonly result = signal<UnitImportResultDto | null>(null);

  private contentBase64: string | null = null;
  private buildingId: string | null = null;

  protected readonly hasFile = computed(() => this.contentBase64 !== null);

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set('Αποτυχία φόρτωσης της πολυκατοικίας.');
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
      });
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.error.set(null);
    this.preview.set(null);
    this.result.set(null);
    if (!file) {
      this.contentBase64 = null;
      this.filename.set(null);
      return;
    }
    try {
      this.contentBase64 = await readFileAsBase64(file);
      this.filename.set(file.name);
    } catch {
      this.contentBase64 = null;
      this.filename.set(null);
      this.error.set('Αποτυχία ανάγνωσης του αρχείου.');
    }
  }

  protected runPreview(): void {
    this.send(false);
  }

  protected confirm(): void {
    this.send(true);
  }

  private send(confirm: boolean): void {
    const buildingId = this.buildingId;
    const filename = this.filename();
    if (!buildingId || !this.contentBase64 || !filename || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    this.excelImportApi
      .importUnits(buildingId, {
        filename,
        contentBase64: this.contentBase64,
        confirm,
      })
      .pipe(
        catchError(() => {
          this.error.set(
            'Η επεξεργασία του αρχείου απέτυχε. Ελέγξτε τη μορφή (.xlsx/.csv) και ξαναδοκιμάστε.',
          );
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this.busy.set(false);
        if ('rows' in response) {
          this.preview.set(response);
          this.result.set(null);
        } else {
          this.result.set(response);
          this.preview.set(null);
        }
      });
  }
}
