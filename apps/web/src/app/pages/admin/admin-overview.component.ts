import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import { formatPeriod } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { CategoriesApiService } from '../../core/api/categories-api.service';
import { ExpensesApiService } from '../../core/api/expenses-api.service';
import { InvoicesApiService } from '../../core/api/invoices-api.service';
import { UnitsApiService } from '../../core/api/units-api.service';
import { formatEuros } from '../../ui/format';
import { MoneyPipe } from '../../ui/money.pipe';
import {
  HelpTourComponent,
  HelpTourStep,
} from '../../ui/help-tour.component';
import { TourService } from '../../core/tour.service';

interface OverviewStats {
  units: number;
  categories: number;
  expensesCents: number;
  invoices: number;
}

@Component({
  selector: 'app-admin-overview',
  imports: [ReactiveFormsModule, HelpTourComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Επισκόπηση</h1>

    @if (buildingMissing()) {
      <div class="card max-w-lg">
        <h2 class="card-title">Δεν έχετε κτίριο — δημιουργήστε ένα</h2>
        <form [formGroup]="buildingForm" (ngSubmit)="createBuilding()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="name">Όνομα κτιρίου</label>
            <input id="name" type="text" class="input" formControlName="name" />
            @if (buildingForm.controls.name.invalid && buildingForm.controls.name.touched) {
              <p class="field-error">Το όνομα είναι υποχρεωτικό.</p>
            }
          </div>
          <div>
            <label class="label" for="address">Διεύθυνση</label>
            <input id="address" type="text" class="input" formControlName="address" />
          </div>
          <button type="submit" class="btn btn-primary self-start" [disabled]="creating()">
            Δημιουργία
          </button>
        </form>
      </div>
    } @else {
      @if (loadError()) {
        <div class="card border-red-200 bg-red-50 text-sm text-red-700">
          Αποτυχία φόρτωσης δεδομένων. Δοκιμάστε να ανανεώσετε τη σελίδα.
        </div>
      }
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card">
          <p class="text-sm text-slate-500">Διαμερίσματα</p>
          <p class="stat-value mt-1">{{ stats()?.units ?? '—' }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Κατηγορίες</p>
          <p class="stat-value mt-1">{{ stats()?.categories ?? '—' }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Έξοδα {{ period }}</p>
          <p class="stat-value mt-1">
            @if (stats(); as s) {
              {{ s.expensesCents | money }}
            } @else {
              —
            }
          </p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Κοινόχρηστα {{ period }}</p>
          <p class="stat-value mt-1">{{ stats()?.invoices ?? '—' }}</p>
        </div>
      </div>
    }

    @if (showTour()) {
      <app-help-tour
        tourId="admin-overview"
        [steps]="tourSteps"
        (closed)="showTour.set(false)"
      />
    }
  `,
})
export class AdminOverviewPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly expensesApi = inject(ExpensesApiService);
  private readonly invoicesApi = inject(InvoicesApiService);
  private readonly fb = inject(FormBuilder);
  private readonly tour = inject(TourService);

  protected readonly period = formatPeriod(new Date());
  protected readonly stats = signal<OverviewStats | null>(null);
  protected readonly loadError = signal(false);
  protected readonly buildingMissing = signal(false);
  protected readonly creating = signal(false);

  /** Ξενάγηση πρώτης χρήσης για νέους διαχειριστές. */
  protected readonly showTour = signal(this.tour.launch('admin-overview'));
  protected readonly tourSteps: HelpTourStep[] = [
    {
      title: 'Καλώς ήρθατε!',
      body: 'Αυτή είναι η κεντρική επισκόπηση του κτιρίου σας.',
    },
    {
      title: 'Βασικά μεγέθη',
      body: 'Διαμερίσματα, έξοδα και κοινόχρηστα του τρέχοντα μήνα με μια ματιά.',
      selector: '.card',
    },
  ];

  protected readonly buildingForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    address: [''],
  });

  protected euros = formatEuros;

  ngOnInit(): void {
    this.load();
  }

  protected createBuilding(): void {
    if (this.buildingForm.invalid || this.creating()) return;
    this.creating.set(true);
    this.buildingsApi.create(this.buildingForm.getRawValue()).subscribe({
      next: () => this.load(),
      error: () => this.creating.set(false),
    });
  }

  private load(): void {
    this.loadError.set(false);
    this.buildingMissing.set(false);
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.buildingMissing.set(true);
          return EMPTY;
        }),
      )
      .subscribe((building) =>
        forkJoin({
          units: this.unitsApi.list(building.id),
          categories: this.categoriesApi.list(building.id),
          expenses: this.expensesApi.list(building.id, this.period),
          invoices: this.invoicesApi.list(building.id, this.period),
        }).subscribe({
          next: ({ units, categories, expenses, invoices }) =>
            this.stats.set({
              units: units.length,
              categories: categories.length,
              expensesCents: expenses.reduce((sum, e) => sum + e.totalCents, 0),
              invoices: invoices.length,
            }),
          error: () => this.loadError.set(true),
        }),
      );
  }
}
