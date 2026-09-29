import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { EMPTY, catchError, filter, forkJoin } from 'rxjs';
import {
  Expense,
  ExpenseCategory,
  formatPeriod,
  isValidPeriod,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { CategoriesApiService } from '../../core/api/categories-api.service';
import { ExpensesApiService } from '../../core/api/expenses-api.service';
import { UnitsApiService } from '../../core/api/units-api.service';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';

@Component({
  selector: 'app-admin-expenses',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Έξοδα</h1>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card lg:col-span-1">
        <h2 class="card-title">Νέο έξοδο</h2>
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="categoryId">Κατηγορία</label>
            <select id="categoryId" class="input" formControlName="categoryId">
              <option value="" disabled>Επιλέξτε κατηγορία</option>
              @for (category of categories(); track category.id) {
                <option [value]="category.id">{{ category.name }}</option>
              }
            </select>
            @if (submitted() && form.controls.categoryId.invalid) {
              <p class="field-error">Επιλέξτε κατηγορία.</p>
            }
          </div>
          <div>
            <label class="label" for="description">Περιγραφή</label>
            <input id="description" type="text" class="input" formControlName="description" />
            @if (submitted() && form.controls.description.invalid) {
              <p class="field-error">Η περιγραφή είναι υποχρεωτική.</p>
            }
          </div>
          <div>
            <label class="label" for="amount">Ποσό (€)</label>
            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              class="input"
              formControlName="amount"
            />
            @if (submitted() && form.controls.amount.invalid) {
              <p class="field-error">Δώστε έγκυρο ποσό μεγαλύτερο του μηδενός.</p>
            }
          </div>
          <div>
            <label class="label" for="period">Περίοδος</label>
            <input id="period" type="month" class="input" formControlName="period" />
            @if (submitted() && !isValidPeriod(form.controls.period.value)) {
              <p class="field-error">Δώστε έγκυρη περίοδο (YYYY-MM).</p>
            }
          </div>
          <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
            Καταχώρηση
          </button>
        </form>
      </div>

      <div class="lg:col-span-2">
        <div class="mb-4 flex items-end gap-4">
          <div>
            <label class="label" for="filterPeriod">Φίλτρο περιόδου</label>
            <input
              id="filterPeriod"
              type="month"
              class="input"
              [formControl]="periodCtrl"
            />
          </div>
        </div>

        @if (loadError()) {
          <div class="card mb-4 border-red-200 bg-red-50 text-sm text-red-700">
            Αποτυχία φόρτωσης εξόδων.
          </div>
        }

        <div class="card overflow-x-auto p-0">
          <table class="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Περιγραφή</th>
                <th>Κατηγορία</th>
                <th>Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              @for (expense of expenses(); track expense.id) {
                <tr>
                  <td>
                    <button
                      type="button"
                      class="btn btn-secondary !px-2 !py-1 text-xs"
                      (click)="toggle(expense.id)"
                      aria-label="Εναλλαγή ανάλυσης"
                      [attr.aria-expanded]="expanded() === expense.id"
                    >
                      {{ expanded() === expense.id ? '▾' : '▸' }}
                    </button>
                  </td>
                  <td class="font-medium">{{ expense.description }}</td>
                  <td>{{ categoryName(expense.categoryId) }}</td>
                  <td>{{ euros(expense.totalCents) }}</td>
                </tr>
                @if (expanded() === expense.id) {
                  <tr>
                    <td></td>
                    <td colspan="3" class="bg-slate-50">
                      @if (expense.shares?.length) {
                        <ul class="divide-y divide-slate-100">
                          @for (share of expense.shares; track share.id) {
                            <li class="flex justify-between py-1 text-xs">
                              <span>{{ unitLabel(share.unitId) }}</span>
                              <span>{{ euros(share.amountCents) }}</span>
                            </li>
                          }
                        </ul>
                      } @else {
                        <span class="text-xs text-slate-500">
                          Δεν υπάρχει διαθέσιμη ανάλυση.
                        </span>
                      }
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="4" class="py-8 text-center text-slate-500">
                    Δεν υπάρχουν έξοδα για την επιλεγμένη περίοδο.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class AdminExpensesPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly expensesApi = inject(ExpensesApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly isValidPeriod = isValidPeriod;
  protected readonly euros = formatEuros;

  protected readonly categories = signal<ExpenseCategory[]>([]);
  protected readonly expenses = signal<Expense[]>([]);
  protected readonly unitLabels = signal<Record<string, string>>({});
  protected readonly expanded = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly loadError = signal(false);

  protected readonly periodCtrl = this.fb.nonNullable.control(
    formatPeriod(new Date()),
  );

  protected readonly form = new FormGroup({
    categoryId: new FormControl<string>('', {
      nonNullable: true,
      validators: Validators.required,
    }),
    description: new FormControl<string>('', {
      nonNullable: true,
      validators: Validators.required,
    }),
    amount: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    period: new FormControl<string>(formatPeriod(new Date()), {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.pattern(/^\d{4}-\d{2}$/),
      ],
    }),
  });

  private buildingId: string | null = null;

  constructor() {
    this.periodCtrl.valueChanges
      .pipe(filter(isValidPeriod), takeUntilDestroyed())
      .subscribe((period) => this.loadExpenses(period));
  }

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        forkJoin({
          units: this.unitsApi.list(building.id),
          categories: this.categoriesApi.list(building.id),
        })
          .pipe(catchError(() => EMPTY))
          .subscribe(({ units, categories }) => {
            const labels: Record<string, string> = {};
            for (const unit of units) labels[unit.id] = unit.label;
            this.unitLabels.set(labels);
            this.categories.set(categories);
          });
        this.loadExpenses(this.periodCtrl.value);
      });
  }

  protected toggle(id: string): void {
    this.expanded.set(this.expanded() === id ? null : id);
  }

  protected categoryName(categoryId: string): string {
    return this.categories().find((c) => c.id === categoryId)?.name ?? '—';
  }

  protected unitLabel(unitId: string): string {
    return this.unitLabels()[unitId] ?? 'Διαμέρισμα';
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    const { categoryId, description, amount, period } = this.form.getRawValue();
    if (!period || !isValidPeriod(period)) return;
    const cents = eurosToCents(amount ?? NaN);
    if (!Number.isFinite(cents) || cents <= 0) return;
    this.saving.set(true);
    this.expensesApi
      .create(this.buildingId, {
        categoryId,
        description,
        totalCents: cents,
        periodYearMonth: period,
      })
      .subscribe({
        next: () => {
          this.toast.success('Ο έξοδος καταχωρήθηκε.');
          this.saving.set(false);
          this.form.reset({
            categoryId: '',
            description: '',
            amount: null,
            period: this.periodCtrl.value,
          });
          this.submitted.set(false);
          this.loadExpenses(this.periodCtrl.value);
        },
        error: () => {
          this.toast.error('Η καταχώρηση απέτυχε.');
          this.saving.set(false);
        },
      });
  }

  private loadExpenses(period: string): void {
    if (!this.buildingId || !isValidPeriod(period)) return;
    this.loadError.set(false);
    this.expanded.set(null);
    this.expensesApi
      .list(this.buildingId, period)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((expenses) => this.expenses.set(expenses));
  }
}
