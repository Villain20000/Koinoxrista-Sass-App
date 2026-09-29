import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import {
  LateFeeChargeDto,
  LateFeeRunResultDto,
  LateFeeSettingsDto,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  LateFeesApiService,
  lateFeeModeLabel,
} from '../../core/api/late-fees-api.service';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';

@Component({
  selector: 'app-admin-late-fees',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">
      Πρόστιμα καθυστέρησης (Ρόπα)
    </h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης. Δοκιμάστε ξανά.
      </div>
    } @else {
      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Settings -->
        <section class="card lg:col-span-1">
          <h2 class="card-title mb-3">Ρυθμίσεις</h2>
          <form [formGroup]="form" (ngSubmit)="saveSettings()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="graceDays">Ημέρες χάριτος</label>
              <input
                id="graceDays"
                type="number"
                min="0"
                max="365"
                class="input"
                formControlName="graceDays"
              />
              @if (submitted() && form.controls.graceDays.invalid) {
                <p class="field-error">Δώστε έγκυρο αριθμό ημερών (0-365).</p>
              }
            </div>
            <div>
              <label class="label" for="mode">Τρόπος υπολογισμού</label>
              <select id="mode" class="input" formControlName="mode">
                <option value="FLAT">{{ modeLabel('FLAT') }}</option>
                <option value="PERCENT">{{ modeLabel('PERCENT') }}</option>
              </select>
            </div>
            @if (form.controls.mode.value === 'FLAT') {
              <div>
                <label class="label" for="dailyFlatEuros">Ποσό ανά ημέρα (€)</label>
                <input
                  id="dailyFlatEuros"
                  type="number"
                  min="0.01"
                  step="0.01"
                  class="input"
                  formControlName="dailyFlatEuros"
                />
              </div>
            } @else {
              <div>
                <label class="label" for="dailyBps">Ποσοστό ανά ημέρα (bps)</label>
                <input
                  id="dailyBps"
                  type="number"
                  min="1"
                  max="10000"
                  class="input"
                  formControlName="dailyBps"
                />
                <p class="mt-1 text-xs text-slate-500">
                  {{ dailyBpsPreview() }} του υπολοίπου ανά ημέρα.
                </p>
              </div>
            }
            <div>
              <label class="label" for="capEuros">Ανώτατο όριο προστίμου (€, προαιρετικό)</label>
              <input
                id="capEuros"
                type="number"
                min="0.01"
                step="0.01"
                class="input"
                formControlName="capEuros"
              />
            </div>
            <button type="submit" class="btn btn-primary self-start" [disabled]="savingSettings()">
              Αποθήκευση
            </button>
          </form>
        </section>

        <!-- Run + charges -->
        <section class="card overflow-x-auto p-0 lg:col-span-2">
          <div class="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
            <div>
              <label class="label" for="month">Μήνας (YYYY-MM, προαιρετικό)</label>
              <input
                id="month"
                type="text"
                class="input !w-36"
                placeholder="π.χ. 2026-06"
                [formControl]="monthCtrl"
              />
            </div>
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="running()"
              (click)="run()"
            >
              Εφαρμογή προστίμων
            </button>
            @if (runResult(); as result) {
              <p class="text-sm font-medium text-emerald-700">
                Επιβλήθηκαν {{ result.charged }} πρόστιμα
                ({{ euros(result.totalCents) }}).
              </p>
            }
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th>Μήνας</th>
                <th>Διαμέρισμα</th>
                <th>Ημέρες καθυστέρησης</th>
                <th>Ποσό</th>
                <th>Κατάσταση</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (charge of charges(); track charge.id) {
                <tr>
                  <td>{{ charge.month }}</td>
                  <td class="font-medium">{{ charge.unitLabel || '—' }}</td>
                  <td>{{ charge.daysLate }}</td>
                  <td class="font-medium">{{ euros(charge.amountCents) }}</td>
                  <td>
                    @if (charge.waivedAt) {
                      <span class="text-xs text-slate-400">Παραβλέφθηκε</span>
                    } @else {
                      <span class="text-xs font-medium text-red-600">Ενεργό</span>
                    }
                  </td>
                  <td>
                    @if (!charge.waivedAt) {
                      <button
                        type="button"
                        class="btn btn-secondary !px-2 !py-1 text-xs"
                        [disabled]="waiving() === charge.id"
                        (click)="waive(charge)"
                      >
                        Παράβλεψη
                      </button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="py-8 text-center text-slate-500">
                    Δεν υπάρχουν επιβλημένα πρόστιμα.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      </div>
    }
  `,
})
export class AdminLateFeesPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly lateFeesApi = inject(LateFeesApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;
  protected readonly modeLabel = lateFeeModeLabel;

  protected readonly charges = signal<LateFeeChargeDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly submitted = signal(false);
  protected readonly savingSettings = signal(false);
  protected readonly running = signal(false);
  protected readonly waiving = signal<string | null>(null);
  protected readonly runResult = signal<LateFeeRunResultDto | null>(null);

  protected readonly monthCtrl = new FormControl('');

  protected readonly form = this.fb.nonNullable.group({
    graceDays: this.fb.nonNullable.control<number>(5, {
      validators: [Validators.required, Validators.min(0), Validators.max(365)],
    }),
    mode: this.fb.nonNullable.control<'FLAT' | 'PERCENT'>('FLAT'),
    dailyFlatEuros: this.fb.nonNullable.control<number | null>(null),
    dailyBps: this.fb.nonNullable.control<number>(50),
    capEuros: this.fb.nonNullable.control<number | null>(null),
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

  protected dailyBpsPreview(): string {
    const bps = Number(this.form.getRawValue().dailyBps) || 0;
    return `${(bps / 100).toLocaleString('el-GR')} %`;
  }

  protected saveSettings(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.savingSettings()) return;

    const { graceDays, mode, dailyFlatEuros, dailyBps, capEuros } =
      this.form.getRawValue();
    const dailyFlatCents = dailyFlatEuros === null ? undefined : eurosToCents(dailyFlatEuros);
    if (dailyFlatCents !== undefined && !Number.isFinite(dailyFlatCents)) return;
    const capCents = capEuros === null ? null : eurosToCents(capEuros);
    if (capCents !== null && !Number.isFinite(capCents)) return;

    this.savingSettings.set(true);
    this.lateFeesApi
      .updateSettings(this.buildingId, {
        graceDays,
        mode,
        ...(mode === 'FLAT' && dailyFlatCents !== undefined ? { dailyFlatCents } : {}),
        ...(mode === 'PERCENT' ? { dailyBps } : {}),
        capCents,
      })
      .subscribe({
        next: () => {
          this.toast.success('Οι ρυθμίσεις αποθηκεύτηκαν.');
          this.savingSettings.set(false);
          this.submitted.set(false);
        },
        error: () => {
          this.toast.error('Η αποθήκευση απέτυχε.');
          this.savingSettings.set(false);
        },
      });
  }

  protected run(): void {
    if (!this.buildingId || this.running()) return;
    const month = this.monthCtrl.value?.trim() ?? '';
    this.running.set(true);
    this.lateFeesApi
      .run(this.buildingId, month || undefined)
      .subscribe({
        next: (result) => {
          this.runResult.set(result);
          this.toast.success(
            `Επιβλήθηκαν ${result.charged} πρόστιμα (${formatEuros(result.totalCents)}).`,
          );
          this.running.set(false);
          this.reloadCharges();
        },
        error: () => {
          this.toast.error('Η εφαρμογή προστίμων απέτυχε.');
          this.running.set(false);
        },
      });
  }

  protected waive(charge: LateFeeChargeDto): void {
    if (!this.buildingId || this.waiving()) return;
    this.waiving.set(charge.id);
    this.lateFeesApi
      .waive(charge.id)
      .subscribe({
        next: () => {
          this.toast.success('Το πρόστιμο παραβλέφθηκε.');
          this.waiving.set(null);
          this.reloadCharges();
        },
        error: () => {
          this.toast.error('Η παράβλεψη απέτυχε.');
          this.waiving.set(null);
        },
      });
  }

  private reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    forkJoin({
      settings: this.lateFeesApi.settings(this.buildingId),
      charges: this.lateFeesApi.list(this.buildingId),
    })
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ settings, charges }) => {
        this.applySettings(settings);
        this.charges.set(charges);
        this.loading.set(false);
      });
  }

  private reloadCharges(): void {
    if (!this.buildingId) return;
    this.lateFeesApi
      .list(this.buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((charges) => this.charges.set(charges));
  }

  private applySettings(settings: LateFeeSettingsDto): void {
    this.form.patchValue({
      graceDays: settings.graceDays,
      mode: settings.mode,
      dailyFlatEuros: settings.dailyFlatCents / 100,
      dailyBps: settings.dailyBps,
      capEuros: settings.capCents === null ? null : settings.capCents / 100,
    });
  }
}
