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
import type { BuildingExportPayload, BuildingImportResult } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { downloadBlob } from '../../core/api/http-download';
import { TransferApiService } from '../../core/api/transfer-api.service';

@Component({
  selector: 'app-admin-transfer',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Εξαγωγή/Εισαγωγή δεδομένων</h1>

    <div class="card mb-6 grid gap-4">
      <h2 class="font-semibold text-slate-900">Εξαγωγή δεδομένων</h2>
      <p class="text-sm text-slate-500">
        Κατεβάστε πλήρες αντίγραφο ασφαλείας της πολυκατοικίας (διαμερίσματα,
        ιδιοκτησίες, κατηγορίες εξόδων, πάγια έξοδα, προϋπολογισμοί,
        πιστοποιητικά) σε ένα αρχείο JSON.
      </p>
      <div class="flex justify-end">
        <button
          type="button"
          class="btn btn-primary"
          (click)="runExport()"
          [disabled]="exporting() || !buildingId()"
        >
          {{ exporting() ? 'Λήψη…' : 'Λήψη JSON' }}
        </button>
      </div>
    </div>

    @if (exportError()) {
      <div class="card mb-6 border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία λήψης. Δοκιμάστε ξανά.
      </div>
    }

    <div class="card grid gap-4">
      <h2 class="font-semibold text-slate-900">Εισαγωγή δεδομένων</h2>
      <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Προσοχή: η εισαγωγή δημιουργεί πάντα <strong>νέα</strong> πολυκατοικία.
        Οι ιδιοκτησίες συνδέονται μόνο με υπάρχοντα email χρηστών — άγνωστα
        email, κατηγορίες και ημερομηνίες παραλείπονται και αναφέρονται στο
        αποτέλεσμα.
      </div>

      <div>
        <label class="label" for="transfer-file">Φόρτωση αρχείου .json</label>
        <input
          id="transfer-file"
          type="file"
          accept=".json,application/json"
          class="input"
          (change)="onFileSelected($event)"
        />
      </div>

      <div>
        <label class="label" for="transfer-json">JSON</label>
        <textarea
          id="transfer-json"
          class="input min-h-40 font-mono text-xs"
          placeholder='{"version": 1, …}'
          [ngModel]="jsonText()"
          (ngModelChange)="jsonText.set($event)"
        ></textarea>
      </div>

      @if (jsonText().trim().length > 0 && !parsedPayload()) {
        <p class="text-sm text-red-600">
          Μη έγκυρο JSON ή μη υποστηριζόμενη έκδοση (απαιτείται version 1).
        </p>
      }

      <div class="flex justify-end">
        <button
          type="button"
          class="btn btn-primary"
          (click)="runImport()"
          [disabled]="!canImport()"
        >
          {{ busy() ? 'Εισαγωγή…' : 'Εισαγωγή' }}
        </button>
      </div>
    </div>

    @if (importError()) {
      <div class="card mt-6 border-red-200 bg-red-50 text-sm text-red-700">
        {{ importError() }}
      </div>
    }

    @if (result(); as r) {
      <div class="card mt-6 grid gap-4">
        <h2 class="font-semibold text-slate-900">Αποτέλεσμα εισαγωγής</h2>
        <p class="text-sm text-slate-500">
          Δημιουργήθηκε νέα πολυκατοικία με κωδικό
          <span class="font-mono">{{ r.buildingId }}</span>.
        </p>

        <ul class="grid gap-1 text-sm sm:grid-cols-2">
          <li>Διαμερίσματα: {{ r.created.units }}</li>
          <li>Ιδιοκτησίες: {{ r.created.ownerships }}</li>
          <li>Κατηγορίες: {{ r.created.categories }}</li>
          <li>Πάγια έξοδα: {{ r.created.recurringExpenses }}</li>
          <li>Γραμμές προϋπολογισμού: {{ r.created.budgetLines }}</li>
          <li>Πιστοποιητικά/ασφάλειες: {{ r.created.complianceItems }}</li>
        </ul>

        @if (hasSkipped()) {
          <div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p class="mb-1 font-medium">Παραλείφθηκαν:</p>
            @if (r.skipped.ownerships.length > 0) {
              <p>Ιδιοκτήτες (άγνωστα email): {{ r.skipped.ownerships.join(', ') }}</p>
            }
            @if (r.skipped.recurring.length > 0) {
              <p>Πάγια έξοδα: {{ r.skipped.recurring.join(', ') }}</p>
            }
            @if (r.skipped.budgetLines.length > 0) {
              <p>Γραμμές προϋπολογισμού: {{ r.skipped.budgetLines.join(', ') }}</p>
            }
            @if (r.skipped.complianceItems.length > 0) {
              <p>Πιστοποιητικά/ασφάλειες: {{ r.skipped.complianceItems.join(', ') }}</p>
            }
          </div>
        } @else {
          <p class="text-sm text-emerald-700">
            Όλα τα δεδομένα εισήχθησαν επιτυχώς.
          </p>
        }
      </div>
    }
  `,
})
export class AdminTransferPage implements OnInit {
  private readonly transferApi = inject(TransferApiService);
  private readonly buildingsApi = inject(BuildingsApiService);

  protected readonly EXPORT_FILENAME = 'building-export.json';

  protected readonly buildingId = signal<string | null>(null);
  protected readonly exporting = signal(false);
  protected readonly exportError = signal(false);
  protected readonly busy = signal(false);
  protected readonly importError = signal<string | null>(null);
  protected readonly jsonText = signal('');
  protected readonly result = signal<BuildingImportResult | null>(null);

  /** Null when the textarea does not hold a valid version-1 payload. */
  protected readonly parsedPayload = computed<BuildingExportPayload | null>(
    () => {
      const text = this.jsonText().trim();
      if (text.length === 0) return null;
      try {
        const value: unknown = JSON.parse(text);
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          (value as { version?: unknown }).version === 1
        ) {
          return value as BuildingExportPayload;
        }
      } catch {
        /* μη έγκυρο JSON */
      }
      return null;
    },
  );

  protected readonly canImport = computed(
    () => this.parsedPayload() !== null && !this.busy(),
  );

  protected readonly hasSkipped = computed(() => {
    const skipped = this.result()?.skipped;
    if (!skipped) return false;
    return (
      skipped.ownerships.length +
        skipped.recurring.length +
        skipped.budgetLines.length +
        skipped.complianceItems.length >
      0
    );
  });

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId.set(building.id);
      });
  }

  protected runExport(): void {
    const buildingId = this.buildingId();
    if (!buildingId || this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set(false);
    this.transferApi
      .export(buildingId)
      .pipe(
        catchError(() => {
          this.exporting.set(false);
          this.exportError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        downloadBlob(
          response.body ?? new Blob([]),
          this.EXPORT_FILENAME,
        );
        this.exporting.set(false);
      });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.jsonText.set(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  protected runImport(): void {
    const payload = this.parsedPayload();
    if (!payload || this.busy()) return;
    this.busy.set(true);
    this.importError.set(null);
    this.result.set(null);
    this.transferApi
      .import(payload)
      .pipe(
        catchError(() => {
          this.busy.set(false);
          this.importError.set(
            'Η εισαγωγή απέτυχε. Ελέγξτε το JSON και δοκιμάστε ξανά.',
          );
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.result.set(result);
        this.busy.set(false);
      });
  }
}
