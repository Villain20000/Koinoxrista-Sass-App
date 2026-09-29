import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import type {
  ExtraordinaryLevyDto,
  LevyShareDto,
  ReserveFundDto,
} from '@org/shared';
import {
  levyStrategyLabel,
  levyStatusLabel,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  ReserveApiService,
} from '../../core/api/reserve-api.service';
import { UnitsApiService, UnitWithOwners } from '../../core/api/units-api.service';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';

@Component({
  selector: 'app-admin-reserve',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Αποθεματικό</h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης αποθεματικού. Δοκιμάστε ξανά.
      </div>
    } @else {
      <!-- KPI cards -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card">
          <p class="text-sm text-slate-500">Στόχος αποθεματικού</p>
          <p class="stat-value mt-1">{{ euros(fund().targetCents) }}</p>
          <p class="text-xs text-slate-400 mt-1">Επεξεργάσιμο παρακάτω</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Τρέχον υπόλοιπο</p>
          <p class="stat-value mt-1" [class]="fund().balanceCents >= 0 ? 'text-emerald-600' : 'text-red-600'">{{ euros(fund().balanceCents) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Κάλυψη στόχου</p>
          <p class="stat-value mt-1">{{ coveragePercent().toFixed(1) }}%</p>
          <div class="mt-2 h-2 w-full rounded bg-slate-100">
            <div class="h-2 rounded bg-indigo-500 transition-all" [style.width.%]="coverageBarWidth()"></div>
          </div>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Έκτακτες εισφορές</p>
          <p class="stat-value mt-1">{{ levies().length }}</p>
          <p class="text-xs text-slate-400 mt-1">{{ issuedCount() }} εκδοθείσες · {{ draftCount() }} προσχέδια</p>
        </div>
      </div>

      <!-- by-month chart for levies -->
      <section class="card mb-6" aria-label="Έκτακτες εισφορές ανά μήνα">
        <h2 class="card-title mb-3">Έκτακτες εισφορές ανά μήνα</h2>
        @if (levyMonthBars().length === 0) {
          <p class="text-sm text-slate-500">Καμία έκτακτη εισφορά ακόμη.</p>
        } @else {
          <div class="flex flex-col gap-2">
            @for (bar of levyMonthBars(); track bar.month) {
              <div class="flex items-center gap-3 text-sm">
                <span class="w-20 shrink-0 text-slate-500">{{ bar.month }}</span>
                <div class="flex h-4 grow gap-1">
                  <div class="h-4 rounded bg-indigo-500" [style.width.%]="bar.pct"></div>
                </div>
                <span class="w-32 shrink-0 text-right font-medium text-slate-700">
                  {{ euros(bar.totalCents) }}
                </span>
              </div>
            }
          </div>
        }
      </section>

      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Reserve actions -->
        <div class="flex flex-col gap-6 lg:col-span-1">
          <!-- Target form -->
          <div class="card">
            <h2 class="card-title">Στόχος αποθεματικού</h2>
            <form [formGroup]="targetForm" (ngSubmit)="updateTarget()" class="flex flex-col gap-3">
              <div>
                <label class="label" for="targetAmount">Στόχος (€)</label>
                <input id="targetAmount" type="number" min="0" step="0.01" class="input" formControlName="targetAmount" />
                @if (targetSubmitted() && targetForm.controls.targetAmount.invalid) {
                  <p class="field-error">Δώστε έγκυρο ποσό ≥0.</p>
                }
              </div>
              <button type="submit" class="btn btn-primary self-start" [disabled]="savingTarget()">Αποθήκευση στόχου</button>
            </form>
          </div>

          <!-- Contribution form -->
          <div class="card">
            <h2 class="card-title">Συνεισφορά</h2>
            <form [formGroup]="contribForm" (ngSubmit)="contribute()" class="flex flex-col gap-3">
              <div>
                <label class="label" for="contribAmount">Ποσό (€) *</label>
                <input id="contribAmount" type="number" min="0.01" step="0.01" class="input" formControlName="amount" />
                @if (contribSubmitted() && contribForm.controls.amount.invalid) {
                  <p class="field-error">Δώστε έγκυρο ποσό.</p>
                }
              </div>
              <div>
                <label class="label" for="contribSource">Πηγή *</label>
                <select id="contribSource" class="input" formControlName="source">
                  <option value="MANUAL">Χειροκίνητη</option>
                  <option value="INTEREST">Τόκοι</option>
                  <option value="LEVY">Έκτακτη εισφορά</option>
                </select>
              </div>
              <div>
                <label class="label" for="contribNotes">Σημειώσεις (προαιρετικό)</label>
                <textarea id="contribNotes" rows="2" class="input" formControlName="notes" placeholder="π.χ. Εισφορά διαμερίσματος"></textarea>
              </div>
              <button type="submit" class="btn btn-primary self-start" [disabled]="savingContrib()">Καταχώρηση συνεισφοράς</button>
            </form>
          </div>

          <!-- Drawdown form -->
          <div class="card">
            <h2 class="card-title">Ανάληψη</h2>
            <form [formGroup]="drawdownForm" (ngSubmit)="drawdown()" class="flex flex-col gap-3">
              <div>
                <label class="label" for="drawAmount">Ποσό (€) *</label>
                <input id="drawAmount" type="number" min="0.01" step="0.01" class="input" formControlName="amount" />
                @if (drawSubmitted() && drawdownForm.controls.amount.invalid) {
                  <p class="field-error">Δώστε έγκυρο ποσό.</p>
                }
              </div>
              <div>
                <label class="label" for="drawReason">Αιτιολογία *</label>
                <input id="drawReason" type="text" class="input" formControlName="reason" placeholder="π.χ. Επισκευή ανελκυστήρα" />
                @if (drawSubmitted() && drawdownForm.controls.reason.invalid) {
                  <p class="field-error">Η αιτιολογία χρειάζεται ≥2 χαρακτήρες.</p>
                }
              </div>
              <button type="submit" class="btn btn-primary self-start" [disabled]="savingDrawdown()">Καταχώρηση ανάληψης</button>
            </form>
            <p class="mt-2 text-xs text-slate-400">Υπόλοιπο μετά την ανάληψη δεν μπορεί να γίνει αρνητικό (400 αν ανεπαρκές).</p>
          </div>
        </div>

        <!-- Levies -->
        <div class="lg:col-span-2">
          <div class="card mb-4">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="card-title mb-0">Έκτακτες εισφορές</h3>
              <button type="button" class="btn btn-primary !px-3 !py-1 text-sm" (click)="levyModalOpen.set(!levyModalOpen())">
                {{ levyModalOpen() ? 'Κλείσιμο' : 'Νέα έκτακτη εισφορά' }}
              </button>
            </div>

            @if (levyModalOpen()) {
              <form [formGroup]="levyForm" (ngSubmit)="createLevy()" class="flex flex-col gap-3 border-t border-slate-200 pt-4">
                <div>
                  <label class="label" for="levyTitle">Τίτλος *</label>
                  <input id="levyTitle" type="text" class="input" formControlName="title" placeholder="π.χ. Επισκευή ταράτσας" />
                  @if (levySubmitted() && levyForm.controls.title.invalid) {
                    <p class="field-error">Ο τίτλος χρειάζεται ≥2 χαρακτήρες.</p>
                  }
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="label" for="levyTotal">Σύνολο (€) *</label>
                    <input id="levyTotal" type="number" min="0.01" step="0.01" class="input" formControlName="total" />
                    @if (levySubmitted() && levyForm.controls.total.invalid) {
                      <p class="field-error">Δώστε έγκυρο ποσό.</p>
                    }
                  </div>
                  <div>
                    <label class="label" for="levyStrategy">Κατανομή *</label>
                    <select id="levyStrategy" class="input" formControlName="strategy">
                      <option value="MILIMES">Χιλιοστά</option>
                      <option value="UNITS">Ισόποσα</option>
                      <option value="SQUARE_METERS">Τετραγωνικά μέτρα</option>
                      <option value="SHARE_FRACTION">Μερίδιο ιδιοκτησίας (‰)</option>
                      <option value="CUSTOM">Προσαρμοσμένη</option>
                    </select>
                  </div>
                </div>

                @if (levyForm.controls.strategy.value === 'CUSTOM') {
                  <div class="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p class="font-medium text-amber-800 mb-2">Προσαρμοσμένη κατανομή — βάρος ανά διαμέρισμα</p>
                    @if (units().length === 0) {
                      <p class="text-amber-700 text-xs">Δεν βρέθηκαν διαμερίσματα. Δημιουργήστε διαμερίσματα πρώτα.</p>
                    } @else {
                      <div class="grid gap-2">
                        @for (unit of units(); track unit.id) {
                          <div class="flex items-center gap-2">
                            <span class="w-24 shrink-0 text-slate-700">{{ unit.label }} <span class="text-xs text-slate-400">({{ unit.millimes }}‰)</span></span>
                            <input type="number" min="1" step="1" class="input !py-1" [value]="customWeightFor(unit.id)" (input)="setCustomWeight(unit.id, $any($event.target).value)" placeholder="βάρος" />
                          </div>
                        }
                      </div>
                    }
                  </div>
                } @else {
                  <p class="text-xs text-slate-500">
                    @if (levyForm.controls.strategy.value === 'MILIMES') { Η κατανομή θα γίνει αναλογικά με τα χιλιοστά κάθε διαμερίσματος. }
                    @if (levyForm.controls.strategy.value === 'UNITS') { Ισομερής κατανομή: ίδιο ποσό για κάθε διαμέρισμα. }
                    @if (levyForm.controls.strategy.value === 'SQUARE_METERS') { Η κατανομή θα γίνει αναλογικά με τα τετραγωνικά μέτρα κάθε διαμερίσματος. }
                    @if (levyForm.controls.strategy.value === 'SHARE_FRACTION') { Η κατανομή θα γίνει αναλογικά με το μερίδιο ιδιοκτησίας (‰) κάθε διαμερίσματος. }
                    Χρησιμοποιείται ο αλγόριθμος largest-remainder για ακρίβεια cents.
                  </p>
                }

                <!-- Preview shares (computed locally for UX before submit) -->
                @if (previewShares().length > 0) {
                  <div class="mt-2">
                    <h4 class="text-sm font-medium text-slate-700 mb-1">Προεπισκόπηση μεριδίων</h4>
                    <div class="overflow-x-auto rounded border border-slate-200">
                      <table class="data-table !text-xs">
                        <thead>
                          <tr>
                            <th>Διαμέρισμα</th>
                            <th>Χιλιοστά / βάρος</th>
                            <th>Ποσό</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of previewShares(); track row.unitId) {
                            <tr>
                              <td>{{ row.label }}</td>
                              <td>{{ row.weight }}</td>
                              <td class="font-medium">{{ euros(row.amountCents) }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                    <p class="text-xs text-slate-400 mt-1">Σύνολο προεπισκόπησης: {{ euros(previewTotal()) }} — πρέπει να ισούται με το σύνολο.</p>
                  </div>
                }

                <button type="submit" class="btn btn-primary self-start" [disabled]="savingLevy()">Δημιουργία (Προσχέδιο)</button>
              </form>
            }
          </div>

          <!-- Levies table -->
          <div class="card overflow-x-auto p-0">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Τίτλος</th>
                  <th>Σύνολο</th>
                  <th>Στρατηγική</th>
                  <th>Κατάσταση</th>
                  <th>Ημερομηνία</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (levy of levies(); track levy.id) {
                  <tr [class]="selectedLevyId() === levy.id ? 'bg-indigo-50' : ''">
                    <td class="font-medium">{{ levy.title }}</td>
                    <td>{{ euros(levy.totalCents) }}</td>
                    <td>{{ strategyLabel(levy.strategy) }}</td>
                    <td>
                      <span class="badge" [class]="statusBadgeClass(levy.status)">
                        {{ statusLabel(levy.status) }}
                      </span>
                    </td>
                    <td class="text-slate-500">{{ formatDate(levy.createdAt) }}</td>
                    <td class="whitespace-nowrap">
                      <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="selectLevy(levy)">Προβολή</button>
                      @if (levy.status === 'DRAFT') {
                        <button type="button" class="btn btn-primary !px-2 !py-1 ml-1 text-xs" [disabled]="issuingId() === levy.id" (click)="issueLevy(levy)">Έκδοση</button>
                      }
                      @if (levy.status === 'ISSUED') {
                        <button type="button" class="btn btn-secondary !px-2 !py-1 ml-1 text-xs text-amber-700" [disabled]="closingId() === levy.id" (click)="closeLevy(levy)">Κλείσιμο</button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="py-8 text-center text-slate-500">Δεν υπάρχουν έκτακτες εισφορές ακόμη.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Levy detail + share table -->
          @if (selectedLevy(); as detail) {
            <div class="card mt-4">
              <div class="mb-3 flex items-center justify-between">
                <h3 class="card-title mb-0">Λεπτομέρειες: {{ detail.title }}</h3>
                <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="selectedLevyId.set(null); selectedLevy.set(null)">Κλείσιμο</button>
              </div>
              <div class="mb-3 flex flex-wrap gap-2 text-sm">
                <span class="rounded bg-slate-100 px-2 py-1">Σύνολο: <span class="font-semibold">{{ euros(detail.totalCents) }}</span></span>
                <span class="rounded bg-slate-100 px-2 py-1">Στρατηγική: {{ strategyLabel(detail.strategy) }}</span>
                <span class="rounded px-2 py-1 text-xs" [class]="statusBadgeClass(detail.status)">{{ statusLabel(detail.status) }}</span>
              </div>

              @if (detail.shares && detail.shares.length > 0) {
                <div class="overflow-x-auto rounded border border-slate-200">
                  <table class="data-table !text-sm">
                    <thead>
                      <tr>
                        <th>Διαμέρισμα</th>
                        <th>Ποσό</th>
                        <th>Πληρωμένο</th>
                        <th>Υπόλοιπο</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (share of detail.shares; track share.id) {
                        <tr>
                          <td class="font-medium">{{ share.unitLabel || share.unitId }}</td>
                          <td>{{ euros(share.amountCents) }}</td>
                          <td class="text-emerald-600">{{ euros(share.paidCents) }}</td>
                          <td class="font-medium">{{ euros(share.amountCents - share.paidCents) }}</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr class="font-semibold bg-slate-50">
                        <td>Σύνολο</td>
                        <td>{{ euros(sharesTotal(detail.shares)) }}</td>
                        <td>{{ euros(sharesPaidTotal(detail.shares)) }}</td>
                        <td>{{ euros(sharesRemainingTotal(detail.shares)) }}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              } @else {
                <p class="text-sm text-slate-500">Χωρίς μερίδια.</p>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class AdminReservePage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly reserveApi = inject(ReserveApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;
  protected readonly strategyLabel = levyStrategyLabel;
  protected readonly statusLabel = levyStatusLabel;

  protected readonly fund = signal<ReserveFundDto>({
    id: '',
    buildingId: '',
    targetCents: 0,
    balanceCents: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  protected readonly levies = signal<ExtraordinaryLevyDto[]>([]);
  protected readonly units = signal<UnitWithOwners[]>([]);
  protected readonly selectedLevyId = signal<string | null>(null);
  protected readonly selectedLevy = signal<ExtraordinaryLevyDto | null>(null);

  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);

  protected readonly savingTarget = signal(false);
  protected readonly savingContrib = signal(false);
  protected readonly savingDrawdown = signal(false);
  protected readonly savingLevy = signal(false);
  protected readonly issuingId = signal<string | null>(null);
  protected readonly closingId = signal<string | null>(null);

  protected readonly targetSubmitted = signal(false);
  protected readonly contribSubmitted = signal(false);
  protected readonly drawSubmitted = signal(false);
  protected readonly levySubmitted = signal(false);
  protected readonly levyModalOpen = signal(false);

  private buildingId: string | null = null;
  private customWeights = new Map<string, number>();

  protected readonly targetForm = this.fb.nonNullable.group({
    targetAmount: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
  });

  protected readonly contribForm = this.fb.nonNullable.group({
    amount: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    source: this.fb.nonNullable.control<'MANUAL' | 'LEVY' | 'INTEREST'>('MANUAL'),
    notes: [''],
  });

  protected readonly drawdownForm = this.fb.nonNullable.group({
    amount: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    reason: ['', [Validators.required, Validators.minLength(2)]],
  });

  protected readonly levyForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    total: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    strategy: this.fb.nonNullable.control<
      'MILIMES' | 'UNITS' | 'CUSTOM' | 'SQUARE_METERS' | 'SHARE_FRACTION'
    >('MILIMES'),
  });

  protected readonly coveragePercent = computed(() => {
    const f = this.fund();
    if (!f.targetCents || f.targetCents <= 0) return f.balanceCents > 0 ? 100 : 0;
    return Math.min(100, (f.balanceCents / f.targetCents) * 100);
  });

  protected readonly coverageBarWidth = computed(() => {
    const pct = this.coveragePercent();
    // allow over 100 to show full, but cap width at 100
    return Math.min(100, pct);
  });

  protected readonly draftCount = computed(() => this.levies().filter((l) => l.status === 'DRAFT').length);
  protected readonly issuedCount = computed(() => this.levies().filter((l) => l.status === 'ISSUED').length);

  protected readonly levyMonthBars = computed(() => {
    const levies = this.levies();
    const map = new Map<string, number>();
    for (const levy of levies) {
      const month = levy.createdAt.slice(0, 7);
      map.set(month, (map.get(month) ?? 0) + levy.totalCents);
    }
    const months = [...map.entries()]
      .map(([month, totalCents]) => ({ month, totalCents }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const max = Math.max(0, ...months.map((m) => m.totalCents));
    return months.map((m) => ({
      ...m,
      pct: max > 0 ? Math.max((m.totalCents / max) * 100, 2) : 0,
    }));
  });

  // preview shares: local largest-remainder split for UX
  protected readonly previewShares = computed(() => {
    const total = eurosToCents(this.levyForm.controls.total.value ?? NaN);
    const strategy = this.levyForm.controls.strategy.value;
    const units = this.units();
    if (!Number.isFinite(total) || total <= 0 || units.length === 0) return [];
    let weights: Array<{ id: string; weight: number; label: string }> = [];
    if (strategy === 'MILIMES') {
      weights = units.map((u) => ({ id: u.id, weight: u.millimes, label: u.label }));
    } else if (strategy === 'UNITS') {
      weights = units.map((u) => ({ id: u.id, weight: 1, label: u.label }));
    } else if (strategy === 'SQUARE_METERS') {
      weights = units.map((u) => ({
        id: u.id,
        weight: Math.round((u.squareMeters ?? 0) * 100),
        label: u.label,
      }));
    } else if (strategy === 'SHARE_FRACTION') {
      weights = units.map((u) => ({
        id: u.id,
        weight: u.shareFraction ?? 0,
        label: u.label,
      }));
    } else {
      weights = units.map((u) => ({
        id: u.id,
        weight: this.customWeights.get(u.id) ?? 0,
        label: u.label,
      }));
      if (weights.some((w) => w.weight <= 0)) return [];
    }
    const sumW = weights.reduce((a, w) => a + w.weight, 0);
    if (sumW <= 0) return [];
    // local splitByLargestRemainder implementation
    const exact = weights.map((w) => ({ ...w, share: (w.weight * total) / sumW }));
    const floored = exact.map((e) => ({ ...e, base: Math.floor(e.share) }));
    let remainder = total - floored.reduce((a, e) => a + e.base, 0);
    const order = floored
      .map((e, idx) => ({ idx, fraction: e.share - e.base }))
      .sort((a, b) => b.fraction - a.fraction || a.idx - b.idx);
    const amounts = floored.map((e) => e.base);
    for (const c of order) {
      if (remainder === 0) break;
      amounts[c.idx] += 1;
      remainder--;
    }
    return weights.map((w, i) => ({
      unitId: w.id,
      label: w.label,
      weight: w.weight,
      amountCents: amounts[i],
    }));
  });

  protected readonly previewTotal = computed(() =>
    this.previewShares().reduce((a, r) => a + r.amountCents, 0),
  );

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.unitsApi
          .list(building.id)
          .pipe(catchError(() => EMPTY))
          .subscribe((units) => this.units.set(units));
        this.reloadAll();
      });
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }

  protected sharesTotal(shares: LevyShareDto[]): number {
    return shares.reduce((a, s) => a + s.amountCents, 0);
  }
  protected sharesPaidTotal(shares: LevyShareDto[]): number {
    return shares.reduce((a, s) => a + s.paidCents, 0);
  }
  protected sharesRemainingTotal(shares: LevyShareDto[]): number {
    return shares.reduce((a, s) => a + (s.amountCents - s.paidCents), 0);
  }

  protected statusBadgeClass(status: string): string {
    switch (status) {
      case 'DRAFT':
        return 'bg-slate-100 text-slate-700';
      case 'ISSUED':
        return 'bg-amber-100 text-amber-800';
      case 'CLOSED':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  protected customWeightFor(unitId: string): number | '' {
    const v = this.customWeights.get(unitId);
    return v ?? '';
  }

  protected setCustomWeight(unitId: string, raw: string): void {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      this.customWeights.delete(unitId);
    } else {
      this.customWeights.set(unitId, Math.round(n));
    }
    // trigger preview recompute by touching form
    this.levyForm.controls.strategy.updateValueAndValidity({ emitEvent: true });
  }

  protected updateTarget(): void {
    this.targetSubmitted.set(true);
    if (!this.buildingId || this.targetForm.invalid || this.savingTarget()) return;
    const euros = this.targetForm.controls.targetAmount.value;
    const cents = eurosToCents(euros ?? NaN);
    if (!Number.isFinite(cents) || cents < 0) return;
    this.savingTarget.set(true);
    this.reserveApi.updateTarget(this.buildingId, cents).subscribe({
      next: (fund) => {
        this.fund.set(fund);
        this.targetSubmitted.set(false);
        this.savingTarget.set(false);
        this.toast.success('Ο στόχος αποθεματικού ενημερώθηκε.');
      },
      error: () => {
        this.savingTarget.set(false);
        this.toast.error('Η ενημέρωση στόχου απέτυχε.');
      },
    });
  }

  protected contribute(): void {
    this.contribSubmitted.set(true);
    if (!this.buildingId || this.contribForm.invalid || this.savingContrib()) return;
    const { amount, source, notes } = this.contribForm.getRawValue();
    const cents = eurosToCents(amount ?? NaN);
    if (!Number.isFinite(cents) || cents <= 0) return;
    this.savingContrib.set(true);
    this.reserveApi
      .contribute(this.buildingId, {
        amountCents: cents,
        source,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      .subscribe({
        next: ({ fund }) => {
          this.fund.set(fund);
          this.contribSubmitted.set(false);
          this.contribForm.reset({ amount: null, source: 'MANUAL', notes: '' });
          this.savingContrib.set(false);
          this.toast.success('Η συνεισφορά καταχωρήθηκε.');
        },
        error: (err) => {
          this.savingContrib.set(false);
          const msg = err?.error?.message || 'Η καταχώρηση απέτυχε.';
          this.toast.error(Array.isArray(msg) ? msg.join(', ') : String(msg));
        },
      });
  }

  protected drawdown(): void {
    this.drawSubmitted.set(true);
    if (!this.buildingId || this.drawdownForm.invalid || this.savingDrawdown()) return;
    const { amount, reason } = this.drawdownForm.getRawValue();
    const cents = eurosToCents(amount ?? NaN);
    if (!Number.isFinite(cents) || cents <= 0) return;
    this.savingDrawdown.set(true);
    this.reserveApi
      .drawdown(this.buildingId, {
        amountCents: cents,
        reason: reason.trim(),
      })
      .subscribe({
        next: ({ fund }) => {
          this.fund.set(fund);
          this.drawSubmitted.set(false);
          this.drawdownForm.reset({ amount: null, reason: '' });
          this.savingDrawdown.set(false);
          this.toast.success('Η ανάληψη καταχωρήθηκε.');
        },
        error: (err) => {
          this.savingDrawdown.set(false);
          const msg = err?.error?.message || 'Η ανάληψη απέτυχε.';
          if (String(msg).includes('Insufficient')) {
            this.toast.error('Ανεπαρκές υπόλοιπο αποθεματικού.');
          } else {
            this.toast.error(Array.isArray(msg) ? msg.join(', ') : String(msg));
          }
        },
      });
  }

  protected createLevy(): void {
    this.levySubmitted.set(true);
    if (!this.buildingId || this.levyForm.invalid || this.savingLevy()) return;
    const { title, total, strategy } = this.levyForm.getRawValue();
    const cents = eurosToCents(total ?? NaN);
    if (!Number.isFinite(cents) || cents <= 0) return;

    let customWeights: { unitId: string; weight: number }[] | undefined;
    if (strategy === 'CUSTOM') {
      customWeights = this.units().map((u) => ({
        unitId: u.id,
        weight: this.customWeights.get(u.id) ?? 0,
      }));
      if (customWeights.some((w) => w.weight <= 0)) {
        this.toast.error('Δώστε βάρος >0 για κάθε διαμέρισμα.');
        return;
      }
    }

    this.savingLevy.set(true);
    this.reserveApi
      .createLevy(this.buildingId, {
        title: title.trim(),
        totalCents: cents,
        strategy,
        ...(customWeights ? { customWeights } : {}),
      })
      .subscribe({
        next: () => {
          this.levySubmitted.set(false);
          this.levyForm.reset({ title: '', total: null, strategy: 'MILIMES' });
          this.customWeights.clear();
          this.levyModalOpen.set(false);
          this.savingLevy.set(false);
          this.toast.success('Η έκτακτη εισφορά δημιουργήθηκε (προσχέδιο).');
          this.reloadAll();
        },
        error: (err) => {
          this.savingLevy.set(false);
          const msg = err?.error?.message || 'Η δημιουργία απέτυχε.';
          this.toast.error(Array.isArray(msg) ? msg.join(', ') : String(msg));
        },
      });
  }

  protected selectLevy(levy: ExtraordinaryLevyDto): void {
    if (!this.buildingId) return;
    this.selectedLevyId.set(levy.id);
    this.reserveApi
      .getLevy(this.buildingId, levy.id)
      .pipe(catchError(() => EMPTY))
      .subscribe((detail) => {
        // enrich shares with unitLabel if missing
        if (detail.shares) {
          for (const s of detail.shares) {
            if (!s.unitLabel) {
              s.unitLabel = this.units().find((u) => u.id === s.unitId)?.label ?? s.unitId;
            }
          }
        }
        this.selectedLevy.set(detail);
      });
  }

  protected issueLevy(levy: ExtraordinaryLevyDto): void {
    if (!this.buildingId || this.issuingId()) return;
    this.issuingId.set(levy.id);
    this.reserveApi.issueLevy(this.buildingId, levy.id).subscribe({
      next: () => {
        this.issuingId.set(null);
        this.toast.success(`Η εισφορά «${levy.title}» εκδόθηκε και πιστώθηκε στο αποθεματικό.`);
        this.reloadAll();
        if (this.selectedLevyId() === levy.id) this.selectLevy(levy);
      },
      error: (err) => {
        this.issuingId.set(null);
        const msg = err?.error?.message || 'Η έκδοση απέτυχε.';
        this.toast.error(Array.isArray(msg) ? msg.join(', ') : String(msg));
      },
    });
  }

  protected closeLevy(levy: ExtraordinaryLevyDto): void {
    if (!this.buildingId || this.closingId()) return;
    this.closingId.set(levy.id);
    this.reserveApi.closeLevy(this.buildingId, levy.id).subscribe({
      next: () => {
        this.closingId.set(null);
        this.toast.success(`Η εισφορά «${levy.title}» έκλεισε.`);
        this.reloadAll();
      },
      error: (err) => {
        this.closingId.set(null);
        const msg = err?.error?.message || 'Το κλείσιμο απέτυχε.';
        this.toast.error(Array.isArray(msg) ? msg.join(', ') : String(msg));
      },
    });
  }

  private reloadAll(): void {
    if (!this.buildingId) return;
    this.loading.set(true);
    this.loadError.set(false);
    forkJoin({
      fund: this.reserveApi.getFund(this.buildingId),
      levies: this.reserveApi.listLevies(this.buildingId),
    })
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ fund, levies }) => {
        this.fund.set(fund);
        // patch target form to current target
        this.targetForm.controls.targetAmount.setValue(
          fund.targetCents / 100,
          { emitEvent: false },
        );
        this.levies.set(levies);
        this.loading.set(false);
      });
  }
}
