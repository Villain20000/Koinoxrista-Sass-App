import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import type { AnnouncementAudience, AnnouncementDto } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { AnnouncementsApiService } from '../../core/api/announcements-api.service';
import { ToastService } from '../../ui/toast.service';

const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  ALL: 'Όλοι',
  RESIDENTS: 'Μόνο ένοικοι',
};

@Component({
  selector: 'app-admin-announcements',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Ανακοινώσεις</h1>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card lg:col-span-1">
        <h2 class="card-title">
          {{ editingId() ? 'Επεξεργασία ανακοίνωσης' : 'Νέα ανακοίνωση' }}
        </h2>
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="title">Τίτλος</label>
            <input
              id="title"
              type="text"
              class="input"
              formControlName="title"
              placeholder="π.χ. Διακοπή νερού"
            />
            @if (submitted() && form.controls.title.invalid) {
              <p class="field-error">
                Ο τίτλος χρειάζεται από 2 έως 200 χαρακτήρες.
              </p>
            }
          </div>
          <div>
            <label class="label" for="body">Κείμενο</label>
            <textarea
              id="body"
              rows="6"
              class="input"
              formControlName="body"
              placeholder="Το περιεχόμενο της ανακοίνωσης…"
            ></textarea>
            @if (submitted() && form.controls.body.invalid) {
              <p class="field-error">
                Το κείμενο χρειάζεται από 2 έως 5000 χαρακτήρες.
              </p>
            }
          </div>
          <div>
            <label class="label" for="audience">Κοινό</label>
            <select id="audience" class="input" formControlName="audience">
              @for (option of audiences; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" formControlName="pinned" />
            Καρφίτσωμα στην κορυφή της ροής
          </label>
          <div class="flex items-center gap-2">
            <button
              type="submit"
              class="btn btn-primary self-start"
              [disabled]="saving()"
            >
              {{ editingId() ? 'Αποθήκευση' : 'Δημοσίευση' }}
            </button>
            @if (editingId()) {
              <button type="button" class="btn btn-secondary" (click)="resetForm()">
                Άκυρο
              </button>
            }
          </div>
        </form>
      </div>

      <div class="lg:col-span-2">
        @if (loadError()) {
          <div class="card border-red-200 bg-red-50 text-sm text-red-700">
            Αποτυχία φόρτωσης ανακοινώσεων.
          </div>
        }
        <div class="flex flex-col gap-3">
          @for (item of items(); track item.id) {
            <article class="card flex flex-col gap-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h2 class="font-semibold text-slate-900">
                    @if (item.pinned) {
                      <span title="Καρφιτσωμένη" aria-label="Καρφιτσωμένη">📌 </span>
                    }
                    {{ item.title }}
                  </h2>
                  <p class="text-xs text-slate-500">
                    {{ formatDate(item.createdAt) }} · {{ authorLabel(item) }} ·
                    {{ audienceLabel(item.audience) }}
                  </p>
                </div>
                <span class="badge shrink-0 bg-slate-100 text-slate-600">
                  {{ item.commentsCount }} σχόλια
                </span>
              </div>
              <p class="whitespace-pre-line text-sm text-slate-600">{{ item.body }}</p>
              <div class="flex flex-wrap gap-1 border-t border-slate-100 pt-2">
                <button
                  type="button"
                  class="btn btn-secondary !px-2 !py-1 text-xs"
                  [disabled]="busyId() === item.id"
                  (click)="togglePin(item)"
                >
                  {{ item.pinned ? 'Ξεκαρφίτσωμα' : 'Καρφίτσωμα' }}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary !px-2 !py-1 text-xs"
                  (click)="edit(item)"
                >
                  Επεξεργασία
                </button>
                <button
                  type="button"
                  class="btn btn-secondary ml-1 !px-2 !py-1 text-xs text-red-600"
                  [disabled]="busyId() === item.id"
                  (click)="remove(item)"
                >
                  Διαγραφή
                </button>
              </div>
            </article>
          } @empty {
            @if (!loading() && !loadError()) {
              <div class="card text-sm text-slate-500">
                Δεν υπάρχουν ανακοινώσεις ακόμη — δημοσιεύστε την πρώτη σας.
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class AdminAnnouncementsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly announcementsApi = inject(AnnouncementsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly items = signal<AnnouncementDto[]>([]);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);

  protected readonly audiences = (
    Object.keys(AUDIENCE_LABELS) as AnnouncementAudience[]
  ).map((value) => ({ value, label: AUDIENCE_LABELS[value] }));

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(200)]],
    body: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(5000)]],
    audience: this.fb.nonNullable.control<AnnouncementAudience>('ALL'),
    pinned: false,
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.loading.set(false);
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected audienceLabel(audience: string): string {
    return AUDIENCE_LABELS[audience as AnnouncementAudience] ?? audience;
  }

  protected authorLabel(item: AnnouncementDto): string {
    return item.authorName || '—';
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString('el-GR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    const value = this.form.getRawValue();
    const payload = {
      title: value.title.trim(),
      body: value.body.trim(),
      audience: value.audience,
      pinned: value.pinned,
    };

    const editing = this.editingId();
    this.saving.set(true);
    const request$ = editing
      ? this.announcementsApi.update(editing, payload)
      : this.announcementsApi.create(this.buildingId, payload);
    request$.subscribe({
      next: () => {
        this.toast.success(
          editing ? 'Η ανακοίνωση ενημερώθηκε.' : 'Η ανακοίνωση δημοσιεύτηκε.',
        );
        this.saving.set(false);
        this.resetForm();
        this.reload();
      },
      error: () => {
        this.toast.error('Η αποθήκευση απέτυχε.');
        this.saving.set(false);
      },
    });
  }

  protected togglePin(item: AnnouncementDto): void {
    if (this.busyId()) return;
    this.busyId.set(item.id);
    this.announcementsApi
      .update(item.id, { pinned: !item.pinned })
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.reload();
        },
        error: () => {
          this.busyId.set(null);
          this.toast.error('Η αλλαγή καρφιτσώματος απέτυχε.');
        },
      });
  }

  protected edit(item: AnnouncementDto): void {
    this.editingId.set(item.id);
    this.submitted.set(false);
    this.form.patchValue({
      title: item.title,
      body: item.body,
      audience: item.audience,
      pinned: item.pinned,
    });
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.submitted.set(false);
    this.form.reset({
      title: '',
      body: '',
      audience: 'ALL',
      pinned: false,
    });
  }

  protected remove(item: AnnouncementDto): void {
    this.announcementsApi
      .delete(item.id)
      .pipe(catchError(() => EMPTY))
      .subscribe(() => this.reload());
    this.toast.info(`Διαγράφηκε: ${item.title}`);
  }

  protected reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    this.loading.set(true);
    this.announcementsApi
      .listAdmin(this.buildingId)
      .pipe(
        catchError(() => {
          this.loading.set(false);
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((items) => {
        this.items.set(items);
        this.loading.set(false);
      });
  }
}
