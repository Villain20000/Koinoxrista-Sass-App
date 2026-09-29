import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import { formatPeriod, isValidPeriod } from '@org/shared';
import type { ExpenseCategory, RecurringExpenseDto } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { CategoriesApiService } from '../../core/api/categories-api.service';
import {
  RecurringApiService,
} from '../../core/api/recurring-api.service';
import { eurosToCents, formatEuros } from '../../ui/format';
import { ToastService } from '../../ui/toast.service';

const STRATEGY_LABELS: Record<RecurringExpenseDto['strategy'], string> = {
  MILIMES: 'Μιλήσια',
  UNITS: 'Διαμερίσματα',
};

@Component({
  selector: 'app-admin-recurring',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Πάγια έξοδα</h1>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card lg:col-span-1">
        <h2 class="card-title">Νέο πάγιο έξοδο</h2>
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="name">Όνομα</label>
            <input
              id="name"
              type="text"
              class="input"
              formControlName="name"
              placeholder="π.χ. Συντήρηση ανελκυστήρα"
            />
            @if (submitted() && form.controls.name.invalid) {
              <p class="field-error">Το όνομα είναι υποχρεωτικό.</p>
            }
          </div>
          <div>
            <label class="label" for="amount">Ποσό (€)</label>
            <input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              class="input"
              formControlName="amount"
            />
            @if (submitted() && form.controls.amount.invalid) {
              <p class="field-error">Δώστε έγκυρο ποσό.</p>
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
          <div>
            <label class="label" for="categoryId">Κατηγορία (προαιρετικό)</label>
            <select id="categoryId" class="input" formControlName="categoryId">
              <option value="">— Χωρίς κατηγορία —</option>
              @for (category of categories(); track category.id) {
                <option [value]="category.id">{{ category.name }}</option>
              }
            </select>
          </div>
          <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
            Προσθήκη
          </button>
        </form>

        <h2 class="card-title mt-8">Δημιουργία για μήνα</h2>
        <p class="mb-3 text-xs text-slate-500">
          Καταχωρεί τα ενεργά πάγια ως έξοδα με αναλυτικές δόσεις για την
          επιλεγμένη περίοδο. Επαναλαμβανόμενη κλήση για τον ίδιο μήνα δεν
          δημιουργεί διπλές εγγραφές.
        </p>
        <div class="flex items-end gap-2">
          <div class="flex-1">
            <label class="label" for="generateMonth">Μήνας</label>
            <input
              id="generateMonth"
              type="month"
              class="input"
              [formControl]="generateMonth"
            />
          </div>
          <button
            type="button"
            class="btn btn-secondary"
            (click)="generate()"
            [disabled]="generating()"
          >
            Δημιουργία
          </button>
        </div>
        @if (!isValidPeriod(generateMonth.value)) {
          <p class="field-error">Δώστε έγκυρη περίοδο (YYYY-MM).</p>
        }
      </div>

      <div class="card overflow-x-auto p-0 lg:col-span-2">
        @if (loadError()) {
          <div class="border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Αποτυχία φόρτωσης πάγιων εξόδων.
          </div>
        }
        <table class="data-table">
          <thead>
            <tr>
              <th>Όνομα</th>
              <th>Ποσό</th>
              <th>Κατανομή</th>
              <th>Ενεργό</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (template of templates(); track template.id) {
              <tr>
                <td class="font-medium">{{ template.name }}</td>
                <td>{{ euros(template.amountCents) }}</td>
                <td>{{ strategyLabel(template.strategy) }}</td>
                <td>
                  <button
                    type="button"
                    class="btn !px-2 !py-1 text-xs"
                    [class.btn-primary]="template.active"
                    [class.btn-secondary]="!template.active"
                    (click)="toggleActive(template)"
                  >
                    {{ template.active ? 'Ενεργό' : 'Ανενεργό' }}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn btn-secondary !px-2 !py-1 text-xs text-red-600"
                    (click)="remove(template)"
                  >
                    Διαγραφή
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="py-8 text-center text-slate-500">
                  Δεν υπάρχουν πάγια έξοδα ακόμη.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class AdminRecurringPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly recurringApi = inject(RecurringApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly isValidPeriod = isValidPeriod;
  protected readonly euros = formatEuros;

  protected readonly templates = signal<RecurringExpenseDto[]>([]);
  protected readonly categories = signal<ExpenseCategory[]>([]);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly generating = signal(false);
  protected readonly loadError = signal(false);

  protected readonly strategies: {
    value: RecurringExpenseDto['strategy'];
    label: string;
  }[] = [
    { value: 'MILIMES', label: STRATEGY_LABELS.MILIMES },
    { value: 'UNITS', label: STRATEGY_LABELS.UNITS },
  ];

  protected readonly generateMonth = this.fb.nonNullable.control(
    formatPeriod(new Date()),
  );

  protected readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    amount: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
    strategy: this.fb.nonNullable.control<RecurringExpenseDto['strategy']>(
      'MILIMES',
    ),
    categoryId: [''],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.categoriesApi
          .list(building.id)
          .pipe(catchError(() => EMPTY))
          .subscribe((categories) => this.categories.set(categories));
        this.reload();
      });
  }

  protected strategyLabel(strategy: RecurringExpenseDto['strategy']): string {
    return STRATEGY_LABELS[strategy] ?? strategy;
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    const { name, amount, strategy, categoryId } = this.form.getRawValue();
    const cents = eurosToCents(amount ?? NaN);
    if (!Number.isFinite(cents) || cents < 0) return;
    this.saving.set(true);
    this.recurringApi
      .create(this.buildingId, {
        name: name.trim(),
        amountCents: cents,
        strategy,
        ...(categoryId ? { categoryId } : {}),
      })
      .subscribe({
        next: () => {
          this.toast.success('Το πάγιο έξοδο προστέθηκε.');
          this.saving.set(false);
          this.form.reset({
            name: '',
            amount: null,
            strategy: 'MILIMES',
            categoryId: '',
          });
          this.submitted.set(false);
          this.reload();
        },
        error: () => {
          this.toast.error('Η προσθήκη απέτυχε.');
          this.saving.set(false);
        },
      });
  }

  protected toggleActive(template: RecurringExpenseDto): void {
    if (!this.buildingId) return;
    this.recurringApi
      .update(this.buildingId, template.id, { active: !template.active })
      .pipe(catchError(() => EMPTY))
      .subscribe(() => this.reload());
  }

  protected remove(template: RecurringExpenseDto): void {
    if (!this.buildingId) return;
    this.recurringApi
      .delete(this.buildingId, template.id)
      .pipe(catchError(() => EMPTY))
      .subscribe(() => this.reload());
  }

  protected generate(): void {
    const period = this.generateMonth.value;
    if (!this.buildingId || !isValidPeriod(period) || this.generating()) return;
    this.generating.set(true);
    this.recurringApi.generate(this.buildingId, period).subscribe({
      next: ({ created }) => {
        this.generating.set(false);
        if (created > 0) {
          this.toast.success(`Δημιουργήθηκαν ${created} έξοδα για ${period}.`);
        } else {
          this.toast.info(`Καμία νέα καταχώρηση για ${period}.`);
        }
        this.reload();
      },
      error: () => {
        this.generating.set(false);
        this.toast.error('Η δημιουργία απέτυχε.');
      },
    });
  }

  private reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loadError.set(false);
    this.recurringApi
      .list(buildingId)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((templates) => this.templates.set(templates));
  }
}
