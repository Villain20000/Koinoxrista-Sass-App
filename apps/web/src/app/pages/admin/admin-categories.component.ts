import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import {
  AllocationStrategy,
  ExpenseCategory,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { CategoriesApiService } from '../../core/api/categories-api.service';
import { ToastService } from '../../ui/toast.service';

const STRATEGY_LABELS: Record<AllocationStrategy, string> = {
  MILIMES: 'Κατά χιλιοστά',
  UNITS: 'Ισόποσα ανά διαμέρισμα',
  CUSTOM: 'Προσαρμοσμένα',
  RADIATORS: 'Ανά καλοριφέρ',
  ELEVATOR_FLOORS: 'Ανελκυστήρας ανά όροφο',
  SQUARE_METERS: 'Ανά τετραγωνικά μέτρα',
  SHARE_FRACTION: 'Ανά μερίδιο ιδιοκτησίας',
  HEADCOUNT: 'Ίσα ανά διαμέρισμα (HEADCOUNT)',
};

@Component({
  selector: 'app-admin-categories',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Κατηγορίες εξόδων</h1>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card lg:col-span-1">
        <h2 class="card-title">Νέα κατηγορία</h2>
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="name">Όνομα</label>
            <input id="name" type="text" class="input" formControlName="name" />
            @if (submitted() && form.controls.name.invalid) {
              <p class="field-error">Το όνομα είναι υποχρεωτικό.</p>
            }
          </div>
          <div>
            <label class="label" for="strategy">Κατανομή</label>
            <select id="strategy" class="input" formControlName="strategy">
              @for (option of strategies; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
            Προσθήκη
          </button>
        </form>
      </div>

      <div class="card overflow-x-auto p-0 lg:col-span-2">
        <table class="data-table">
          <thead>
            <tr>
              <th>Κατηγορία</th>
              <th>Κατανομή</th>
            </tr>
          </thead>
          <tbody>
            @for (category of categories(); track category.id) {
              <tr>
                <td class="font-medium">{{ category.name }}</td>
                <td>{{ strategyLabel(category.strategy) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="2" class="py-8 text-center text-slate-500">
                  Δεν υπάρχουν κατηγορίες ακόμη.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class AdminCategoriesPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly strategies: { value: AllocationStrategy; label: string }[] = [
    { value: 'MILIMES', label: STRATEGY_LABELS.MILIMES },
    { value: 'UNITS', label: STRATEGY_LABELS.UNITS },
    { value: 'SQUARE_METERS', label: STRATEGY_LABELS.SQUARE_METERS },
    { value: 'SHARE_FRACTION', label: STRATEGY_LABELS.SHARE_FRACTION },
    { value: 'HEADCOUNT', label: STRATEGY_LABELS.HEADCOUNT },
  ];

  protected readonly categories = signal<ExpenseCategory[]>([]);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    strategy: this.fb.nonNullable.control<AllocationStrategy>('MILIMES'),
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected strategyLabel(strategy: AllocationStrategy): string {
    return STRATEGY_LABELS[strategy] ?? strategy;
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.categoriesApi
      .create(this.buildingId, this.form.getRawValue())
      .subscribe({
        next: () => {
          this.toast.success('Η κατηγορία προστέθηκε.');
          this.saving.set(false);
          this.form.reset({ name: '', strategy: 'MILIMES' });
          this.submitted.set(false);
          this.reload();
        },
        error: () => {
          this.toast.error('Η προσθήκη απέτυχε.');
          this.saving.set(false);
        },
      });
  }

  private reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.categoriesApi
      .list(buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((categories) => this.categories.set(categories));
  }
}
