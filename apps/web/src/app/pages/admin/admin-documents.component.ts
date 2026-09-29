import { ChangeDetectionStrategy, Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import { BuildingDocument } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { DocumentsApiService } from '../../core/api/documents-api.service';
import { downloadBlob } from '../../core/api/http-download';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import { ToastService } from '../../ui/toast.service';
import { formatBytes } from '../../ui/format';

export const DOCUMENT_TYPES = ['ΚΑΝΟΝΙΣΜΟΣ', 'ΠΡΑΚΤΙΚΟ', 'ΤΙΜΟΛΟΓΙΟ', 'ΑΛΛΟ'] as const;

@Component({
  selector: 'app-admin-documents',
  imports: [ReactiveFormsModule, ConfirmModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Έγγραφα</h1>

    <div class="card mb-6">
      <h2 class="card-title">Μεταφόρτωση εγγράφου</h2>
      <form [formGroup]="form" (ngSubmit)="upload()" class="grid gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="type">Κατηγορία</label>
          <select id="type" class="input" formControlName="type">
            @for (t of documentTypes; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </div>
        @if (form.controls.type.value === 'ΑΛΛΟ') {
          <div>
            <label class="label" for="customType">Νέα κατηγορία</label>
            <input id="customType" type="text" class="input" formControlName="customType" />
            @if (submitted() && form.controls.customType.invalid) {
              <p class="field-error">Δώστε κατηγορία.</p>
            }
          </div>
        }
        <div>
          <label class="label" for="file">Αρχείο</label>
          <input
            #fileInput
            id="file"
            type="file"
            class="input"
            (change)="onFileChange($event)"
          />
          @if (submitted() && !selectedFile()) {
            <p class="field-error">Επιλέξτε αρχείο.</p>
          }
        </div>
        <div class="flex items-end">
          <button type="submit" class="btn btn-primary" [disabled]="saving()">
            Μεταφόρτωση
          </button>
        </div>
      </form>
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης εγγράφων.
      </div>
    } @else {
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Όνομα αρχείου</th>
              <th>Κατηγορία</th>
              <th>Μέγεθος</th>
              <th>Μεταφορτωτής</th>
              <th>Ημερομηνία</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (doc of documents(); track doc.id) {
              <tr>
                <td class="font-medium">{{ doc.fileName }}</td>
                <td>{{ doc.type }}</td>
                <td>{{ formatBytes(doc.sizeBytes) }}</td>
                <td>{{ doc.uploaderName ?? '—' }}</td>
                <td>{{ when(doc.createdAt) }}</td>
                <td class="whitespace-nowrap text-right">
                  <button
                    type="button"
                    class="btn btn-secondary !px-2 !py-1 text-xs"
                    (click)="download(doc)"
                  >
                    Λήψη
                  </button>
                  <button
                    type="button"
                    class="btn btn-danger ml-1 !px-2 !py-1 text-xs"
                    (click)="confirmDelete.set(doc)"
                  >
                    Διαγραφή
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="py-8 text-center text-slate-500">
                  Δεν υπάρχουν έγγραφα ακόμη.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (confirmDelete(); as doc) {
      <app-confirm-modal
        title="Διαγραφή εγγράφου"
        [message]="'Θα διαγραφεί οριστικά το «' + doc.fileName + '».'"
        confirmLabel="Διαγραφή"
        [danger]="true"
        (confirmed)="deleteDoc()"
        (cancelled)="confirmDelete.set(null)"
      />
    }
  `,
})
export class AdminDocumentsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly documentsApi = inject(DocumentsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly documentTypes = DOCUMENT_TYPES;
  protected readonly formatBytes = formatBytes;

  protected readonly documents = signal<BuildingDocument[]>([]);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly confirmDelete = signal<BuildingDocument | null>(null);

  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    type: this.fb.nonNullable.control<string>(DOCUMENT_TYPES[0]),
    customType: [''],
  });

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

  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  protected upload(): void {
    const buildingId = this.buildingId;
    const file = this.selectedFile();
    this.submitted.set(true);
    if (!buildingId || !file || this.saving()) return;
    let type = this.form.controls.type.value;
    if (type === 'ΑΛΛΟ') {
      const custom = this.form.controls.customType.value.trim();
      if (!custom) return;
      type = custom;
    }
    this.saving.set(true);
    this.documentsApi
      .upload(buildingId, file, type)
      .pipe(
        catchError(() => {
          this.toast.error('Η μεταφόρτωση απέτυχε.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Το έγγραφο μεταφορτώθηκε.');
        this.saving.set(false);
        this.selectedFile.set(null);
        this.fileInput().nativeElement.value = '';
        this.reload();
      });
  }

  protected download(doc: BuildingDocument): void {
    this.documentsApi
      .download(doc.id)
      .pipe(
        catchError(() => {
          this.toast.error('Η λήψη απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe((blob) => downloadBlob(blob, doc.fileName));
  }

  protected deleteDoc(): void {
    const doc = this.confirmDelete();
    this.confirmDelete.set(null);
    if (!doc) return;
    this.documentsApi
      .delete(doc.id)
      .pipe(
        catchError(() => {
          this.toast.error('Η διαγραφή απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Το έγγραφο διαγράφηκε.');
        this.reload();
      });
  }

  protected when(iso: string | undefined): string {
    return iso
      ? new Date(iso).toLocaleDateString('el-GR')
      : '—';
  }

  private reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    this.documentsApi
      .list(buildingId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((documents) => {
        this.documents.set(documents);
        this.loading.set(false);
      });
  }
}
