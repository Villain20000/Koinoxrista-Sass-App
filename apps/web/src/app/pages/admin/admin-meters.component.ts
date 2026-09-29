import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, catchError, finalize, forkJoin } from 'rxjs';
import type {
  ConsumptionDto,
  MeterDto,
  MetersReadingsMatrixDto,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { MetersApiService } from '../../core/api/meters-api.service';
import { UnitsApiService } from '../../core/api/units-api.service';
import { ToastService } from '../../ui/toast.service';

interface MatrixRow {
  unitId: string;
  unitLabel: string;
  cells: Record<
    string,
    { meterId: string; label?: string | null; value?: number | null } | undefined
  >;
}

const KINDS = ['WATER', 'HEAT'] as const;

const KIND_LABELS: Record<string, string> = {
  WATER: 'Νερό',
  HEAT: 'Θέρμανση',
};

/** Current month as `YYYY-MM` for the default period. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

@Component({
  selector: 'app-admin-meters',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Μετρητές</h1>

    <div class="mb-6">
      <label class="label" for="period">Περίοδος</label>
      <input
        id="period"
        type="month"
        class="input max-w-48"
        [value]="period()"
        (change)="onPeriodChange($event)"
      />
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card lg:col-span-1">
        <h2 class="card-title">Καταχώρηση μετρητή</h2>
        <form [formGroup]="form" (ngSubmit)="registerMeter()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="unitId">Διαμέρισμα</label>
            <select id="unitId" class="input" formControlName="unitId">
              <option value="">— Επιλέξτε —</option>
              @for (unit of units(); track unit.id) {
                <option [value]="unit.id">{{ unit.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="kind">Τύπος</label>
            <select id="kind" class="input" formControlName="kind">
              @for (kind of kinds; track kind) {
                <option [value]="kind">{{ kindLabels[kind] }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="label">Ετικέτα (προαιρετικό)</label>
            <input id="label" type="text" class="input" formControlName="label" />
          </div>
          <button type="submit" class="btn btn-primary self-start" [disabled]="savingMeter()">
            Καταχώρηση
          </button>
        </form>

        <h2 class="card-title mt-6">Μητρώο μετρητών</h2>
        <table class="data-table">
          <thead>
            <tr>
              <th>Διαμέρισμα</th>
              <th>Τύπος</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (meter of meters(); track meter.id) {
              <tr>
                <td>{{ unitLabel(meter.unitId) }}</td>
                <td>{{ kindLabels[meter.kind] ?? meter.kind }}</td>
                <td>
                  <button
                    type="button"
                    class="btn btn-secondary !px-2 !py-1 text-xs text-red-600"
                    (click)="removeMeter(meter)"
                  >
                    Διαγραφή
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="py-6 text-center text-slate-500">
                  Δεν υπάρχουν καταχωρημένοι μετρητές.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="card overflow-x-auto p-0 lg:col-span-2">
        <h2 class="card-title px-4 pt-4">
          Αναγνώσεις — {{ period() }}
          <span class="block text-xs font-normal text-slate-500">
            Οι τιμές είναι ανα μήνα κατανάλωση: λίτρα (νερό) ή Wh (θέρμανση).
          </span>
        </h2>
        @if (loadError()) {
          <div class="m-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Αποτυχία φόρτωσης αναγνώσεων.
          </div>
        }
        <table class="data-table">
          <thead>
            <tr>
              <th>Διαμέρισμα</th>
              @for (kind of kinds; track kind) {
                <th>{{ kindLabels[kind] }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of matrix().rows; track row.unitId) {
              <tr>
                <td class="font-medium">{{ row.unitLabel }}</td>
                @for (kind of kinds; track kind) {
                  <td>
                    @if (row.cells[kind]; as cell) {
                      <input
                        type="number"
                        min="0"
                        step="1"
                        class="input !w-28"
                        [value]="cellValue(row.unitId, kind)"
                        (input)="onCellValueChange(row.unitId, kind, $event)"
                      />
                    } @else {
                      <span class="text-xs text-slate-400">— χωρίς μετρητή —</span>
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="kinds.length + 1" class="py-8 text-center text-slate-500">
                  Δεν υπάρχουν διαμερίσματα.
                </td>
              </tr>
            }
          </tbody>
        </table>
        <div class="flex items-center gap-3 p-4">
          <button
            type="button"
            class="btn btn-primary"
            [disabled]="savingReadings() || dirtyCount() === 0"
            (click)="saveReadings()"
          >
            Αποθήκευση αναγνώσεων
          </button>
          @if (dirtyCount() > 0) {
            <span class="text-xs text-slate-500">{{ dirtyCount() }} μη αποθηκευμένες αλλαγές</span>
          }
        </div>
      </div>
    </div>

    <div class="card mt-6 p-0">
      <h2 class="card-title px-4 pt-4">
        Κατανάλωση ανά διαμέρισμα
        <span class="block text-xs font-normal text-slate-500">
          Προεπισκόπηση της κατανομής METERS — κάθε διαμέρισμα χρειάζεται τουλάχιστον μία ένδειξη.
        </span>
      </h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Διαμέρισμα</th>
            <th>Κατανάλωση</th>
            <th class="w-1/2"></th>
          </tr>
        </thead>
        <tbody>
          @for (entry of consumption(); track entry.unitId) {
            <tr>
              <td class="font-medium">{{ entry.unitLabel }}</td>
              <td>{{ entry.consumed }}</td>
              <td>
                <div class="h-3 w-full rounded bg-slate-100">
                  <div
                    class="h-3 rounded bg-sky-500"
                    [style.width.%]="barWidth(entry)"
                  ></div>
                </div>
              </td>
            </tr>
            @if (!entry.hasReadings) {
              <tr>
                <td colspan="3" class="-mt-2 pb-2 text-xs font-medium text-red-600">
                  Το {{ entry.unitLabel }} δεν έχει ένδειξη για {{ period() }} — η κατανομή METERS
                  θα απορριφθεί.
                </td>
              </tr>
            }
          } @empty {
            <tr>
              <td colspan="3" class="py-8 text-center text-slate-500">
                Χωρίς δεδομένα για {{ period() }}.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminMetersPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly metersApi = inject(MetersApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly kinds = KINDS;
  protected readonly kindLabels = KIND_LABELS;

  protected readonly units = signal<{ id: string; label: string }[]>([]);
  protected readonly meters = signal<MeterDto[]>([]);
  protected readonly matrix = signal<MetersReadingsMatrixDto>({
    period: currentPeriod(),
    kinds: KINDS,
    rows: [],
  });
  protected readonly consumption = signal<ConsumptionDto[]>([]);

  protected readonly period = signal(currentPeriod());
  protected readonly values = signal<Record<string, string>>({});
  protected readonly dirtyKeys = signal<Set<string>>(new Set());

  protected readonly savingMeter = signal(false);
  protected readonly savingReadings = signal(false);
  protected readonly loadError = signal(false);

  protected readonly dirtyCount = computed(() => this.dirtyKeys().size);

  protected readonly maxConsumed = computed(() =>
    Math.max(1, ...this.consumption().map((entry) => entry.consumed)),
  );

  protected readonly form = this.fb.nonNullable.group({
    unitId: ['', Validators.required],
    kind: [KINDS[0]],
    label: [''],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.unitsApi
          .list(building.id)
          .pipe(catchError(() => EMPTY))
          .subscribe((units) =>
            this.units.set(units.map(({ id, label }) => ({ id, label }))),
          );
        this.reload();
      });
  }

  protected onPeriodChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    this.period.set(value);
    this.reload();
  }

  protected unitLabel(unitId: string): string {
    return (
      this.units().find((unit) => unit.id === unitId)?.label ??
      this.matrix()
        .rows.find((row) => row.unitId === unitId)?.unitLabel ??
      '—'
    );
  }

  protected cellValue(unitId: string, kind: string): string {
    return this.values()[`${unitId}:${kind}`] ?? '';
  }

  protected onCellValueChange(
    unitId: string,
    kind: string,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).value;
    const key = `${unitId}:${kind}`;
    this.values.update((current) => ({ ...current, [key]: value }));
    this.dirtyKeys.update((current) => new Set(current).add(key));
  }

  protected barWidth(entry: ConsumptionDto): number {
    return Math.round((entry.consumed / this.maxConsumed()) * 100);
  }

  protected registerMeter(): void {
    if (!this.buildingId || this.form.invalid || this.savingMeter()) return;
    const { unitId, kind, label } = this.form.getRawValue();
    this.savingMeter.set(true);
    this.metersApi
      .register(this.buildingId, {
        unitId,
        kind: kind as (typeof KINDS)[number],
        ...(label.trim() ? { label: label.trim() } : {}),
      })
      .pipe(finalize(() => this.savingMeter.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Ο μετρητής καταχωρήθηκε.');
          this.form.patchValue({ unitId: '', label: '' });
          this.reload();
        },
        error: (error: HttpErrorResponse) =>
          this.toast.error(
            error.status === 409
              ? 'Υπάρχει ήδη μετρητής αυτού του τύπου για το διαμέρισμα.'
              : 'Η καταχώρηση απέτυχε.',
          ),
      });
  }

  protected removeMeter(meter: MeterDto): void {
    if (!this.buildingId) return;
    this.metersApi.delete(meter.id).subscribe({
      next: () => {
        this.toast.info('Ο μετρητής διαγράφηκε μαζί με τις αναγνώσεις του.');
        this.reload();
      },
      error: () => this.toast.error('Η διαγραφή απέτυχε.'),
    });
  }

  /** Saves every dirty cell as an upsert per meter and period. */
  protected saveReadings(): void {
    if (!this.buildingId || this.savingReadings()) return;
    const period = this.period();
    const posts: { meterId: string; value: number }[] = [];
    let missingMeter = false;
    for (const key of this.dirtyKeys()) {
      const raw = this.values()[key];
      if (raw === undefined || raw.trim() === '') continue;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) continue;
      const [unitId, kind] = key.split(':') as [string, 'WATER' | 'HEAT'];
      const row = this.matrix().rows.find((r) => r.unitId === unitId);
      const cell = row ? row.cells[kind] : undefined;
      if (!cell) {
        missingMeter = true;
        continue;
      }
      posts.push({ meterId: cell.meterId, value });
    }
    if (missingMeter) {
      this.toast.error('Υπάρχουν τιμές χωρίς καταχωρημένο μετρητή.');
    }
    if (posts.length === 0) {
      if (!missingMeter) this.dirtyKeys.set(new Set());
      return;
    }

    this.savingReadings.set(true);
    forkJoin(
      posts.map((post) =>
        this.metersApi.saveReading(post.meterId, {
          period,
          value: post.value,
        }),
      ),
    )
      .pipe(finalize(() => this.savingReadings.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Οι αναγνώσεις αποθηκεύτηκαν.');
          this.dirtyKeys.set(new Set());
          this.reload();
        },
        error: () => this.toast.error('Η αποθήκευση απέτυχε.'),
      });
  }

  private reload(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loadError.set(false);
    const period = this.period();
    forkJoin([
      this.metersApi.list(buildingId),
      this.metersApi.readingsMatrix(buildingId, period),
      this.metersApi.consumption(buildingId, period),
    ])
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe(([meters, matrix, consumption]) => {
        this.meters.set(meters);
        this.matrix.set(matrix);
        this.consumption.set(consumption);
        const grid: Record<string, string> = {};
        for (const row of matrix.rows) {
          for (const kind of this.kinds) {
            const cell = (row.cells as MatrixRow['cells'])[kind];
            if (cell?.value !== null && cell?.value !== undefined) {
              grid[`${row.unitId}:${kind}`] = String(cell.value);
            }
          }
        }
        // Keep in-flight edits when only refreshing consumption data.
        const preserved: Record<string, string> = {};
        for (const key of this.dirtyKeys()) {
          preserved[key] = this.values()[key] ?? '';
        }
        this.values.set({ ...grid, ...preserved });
      });
  }
}
