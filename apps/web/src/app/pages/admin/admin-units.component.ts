import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, catchError } from 'rxjs';
import { TOTAL_MILLIMES } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { UnitWithOwners, UnitsApiService } from '../../core/api/units-api.service';
import { ToastService } from '../../ui/toast.service';
import { ownerName } from '../../ui/format';

@Component({
  selector: 'app-admin-units',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-bold text-slate-900">Διαμερίσματα</h1>
      <button type="button" class="btn btn-primary" (click)="startCreate()">
        Νέο διαμέρισμα
      </button>
    </div>

    @if (panelOpen()) {
      <div class="card mb-6">
        <h2 class="card-title">
          {{ editing() ? 'Επεξεργασία διαμερίσματος' : 'Νέο διαμέρισμα' }}
        </h2>

        <div class="mb-4">
          <div class="mb-1 flex justify-between text-xs text-slate-500">
            <span>Συνολικά χιλιοστά κτιρίου</span>
            <span>{{ projectedTotal() }} / {{ totalMillimes }}</span>
          </div>
          <div class="h-2 w-full rounded bg-slate-200">
            <div
              class="h-2 rounded bg-slate-900"
              [class.bg-red-500]="overLimit()"
              [style.width.%]="pct()"
            ></div>
          </div>
          @if (overLimit()) {
            <p class="field-error">
              Το σύνολο υπερβαίνει τα {{ totalMillimes }} χιλιοστά.
            </p>
          }
        </div>

        <form [formGroup]="form" (ngSubmit)="save()" class="grid gap-4 sm:grid-cols-4">
          <div class="sm:col-span-2">
            <label class="label" for="label">Επωνυμία</label>
            <input id="label" type="text" class="input" formControlName="label" />
            @if (submitted() && form.controls.label.invalid) {
              <p class="field-error">Η επωνυμία είναι υποχρεωτική.</p>
            }
          </div>
          <div>
            <label class="label" for="floor">Όροφος</label>
            <input id="floor" type="number" class="input" formControlName="floor" />
          </div>
          <div>
            <label class="label" for="millimes">Χιλιοστά</label>
            <input id="millimes" type="number" min="1" step="1" class="input" formControlName="millimes" />
            @if (submitted() && form.controls.millimes.invalid) {
              <p class="field-error">Δώστε έγκυρα χιλιοστά (&gt; 0).</p>
            }
          </div>
          <div>
            <label class="label" for="squareMeters">Τετραγωνικά μέτρα</label>
            <input id="squareMeters" type="number" min="0" step="0.01" class="input" formControlName="squareMeters" />
          </div>
          <div>
            <label class="label" for="shareFraction">Μερίδιο ιδιοκτησίας (‰)</label>
            <input id="shareFraction" type="number" min="0" max="1000" step="1" class="input" formControlName="shareFraction" />
          </div>
          <div class="flex gap-2 sm:col-span-4">
            <button type="submit" class="btn btn-primary" [disabled]="saving()">
              Αποθήκευση
            </button>
            <button type="button" class="btn btn-secondary" (click)="cancel()">
              Άκυρο
            </button>
          </div>
        </form>
      </div>
    }

    <div class="card overflow-x-auto p-0">
      <table class="data-table">
        <thead>
          <tr>
            <th>Διαμέρισμα</th>
            <th>Όροφος</th>
            <th>Χιλιοστά</th>
            <th>Τ.μ.</th>
            <th>Μερίδιο ‰</th>
            <th>Ιδιοκτήτες</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (unit of units(); track unit.id) {
            <tr>
              <td class="font-medium">{{ unit.label }}</td>
              <td>{{ unit.floor ?? '—' }}</td>
              <td>{{ unit.millimes }}‰</td>
              <td>{{ unit.squareMeters ?? '—' }}</td>
              <td>{{ unit.shareFraction != null ? unit.shareFraction + '‰' : '—' }}</td>
              <td>
                {{ ownersLabel(unit) }}
              </td>
              <td class="text-right">
                <button type="button" class="btn btn-secondary !px-3 !py-1" (click)="startEdit(unit)">
                  Επεξεργασία
                </button>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="py-8 text-center text-slate-500">
                Δεν έχουν προστεθεί διαμερίσματα ακόμη.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminUnitsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly totalMillimes = TOTAL_MILLIMES;
  protected readonly ownerLabel = ownerName;

  protected ownersLabel(unit: UnitWithOwners): string {
    return unit.owners?.length
      ? unit.owners.map((o) => ownerName(o)).join(', ')
      : '—';
  }

  protected readonly units = signal<UnitWithOwners[]>([]);
  protected readonly panelOpen = signal(false);
  protected readonly editing = signal<UnitWithOwners | null>(null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    label: ['', Validators.required],
    floor: this.fb.control<number | null>(null),
    millimes: [
      1,
      [Validators.required, Validators.min(1), Validators.max(TOTAL_MILLIMES)],
    ],
    squareMeters: this.fb.control<number | null>(null),
    shareFraction: this.fb.control<number | null>(null),
  });

  private readonly millimesValue = toSignal(
    this.form.controls.millimes.valueChanges,
    { initialValue: this.form.controls.millimes.value },
  );

  private readonly buildingId = signal<string | null>(null);

  protected readonly projectedTotal = computed(
    () =>
      this.units().reduce((sum, u) => sum + u.millimes, 0) -
      (this.editing()?.millimes ?? 0) +
      (this.millimesValue() ?? 0),
  );

  protected readonly overLimit = computed(
    () => this.projectedTotal() > TOTAL_MILLIMES,
  );

  protected readonly pct = computed(() =>
    Math.min(100, Math.round((this.projectedTotal() / TOTAL_MILLIMES) * 100)),
  );

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId.set(building.id);
        this.reload();
      });
  }

  protected startCreate(): void {
    this.editing.set(null);
    this.submitted.set(false);
    this.form.reset({ label: '', floor: null, millimes: 1, squareMeters: null, shareFraction: null });
    this.panelOpen.set(true);
  }

  protected startEdit(unit: UnitWithOwners): void {
    this.editing.set(unit);
    this.submitted.set(false);
    this.form.reset({
      label: unit.label,
      floor: unit.floor ?? null,
      millimes: unit.millimes,
      squareMeters: unit.squareMeters ?? null,
      shareFraction: unit.shareFraction ?? null,
    });
    this.panelOpen.set(true);
  }

  protected cancel(): void {
    this.panelOpen.set(false);
    this.editing.set(null);
  }

  protected save(): void {
    this.submitted.set(true);
    const buildingId = this.buildingId();
    if (!buildingId || this.form.invalid || this.overLimit() || this.saving()) {
      return;
    }
    const { label, floor, millimes, squareMeters, shareFraction } =
      this.form.getRawValue();
    const dto = {
      label,
      floor: floor ?? undefined,
      millimes,
      squareMeters: squareMeters ?? undefined,
      shareFraction: shareFraction ?? undefined,
    };
    const editing = this.editing();
    this.saving.set(true);
    const request$ = editing
      ? this.unitsApi.update(buildingId, editing.id, dto)
      : this.unitsApi.create(buildingId, dto);
    request$.subscribe({
      next: () => {
        this.toast.success('Το διαμέρισμα αποθηκεύτηκε.');
        this.saving.set(false);
        this.cancel();
        this.reload();
      },
      error: () => {
        this.toast.error('Η αποθήκευση απέτυχε.');
        this.saving.set(false);
      },
    });
  }

  private reload(): void {
    const buildingId = this.buildingId();
    if (!buildingId) return;
    this.unitsApi
      .list(buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((units) => this.units.set(units));
  }
}
