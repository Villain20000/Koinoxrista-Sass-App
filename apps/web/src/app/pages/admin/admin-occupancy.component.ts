import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import type {
  OccupancyDto,
  VotingEligibilityRuleDto,
} from '@org/shared';
import {
  occupantBadge,
  eligibilityCategoryLabel,
  allowedTypesLabel,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { UnitsApiService, UnitWithOwners } from '../../core/api/units-api.service';
import { TenancyApiService } from '../../core/api/tenancy-api.service';
import { ToastService } from '../../ui/toast.service';

const CATEGORIES = ['GENERAL', 'STRUCTURAL', 'FINANCIAL'] as const;

@Component({
  selector: 'app-admin-occupancy',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Ένοικοι &amp; Δικαιώματα Ψήφου</h1>

    @if (loadError()) {
      <div class="card mb-4 border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης. Ελέγξτε ότι η ενότητα tenancy έχει ενεργοποιηθεί.
      </div>
    }

    <div class="card mb-6">
      <label class="label" for="unit-picker">Διαμέρισμα</label>
      <select
        id="unit-picker"
        class="input max-w-sm"
        [value]="selectedUnitId()"
        (change)="onUnitChange($event)"
      >
        <option value="">— Επιλέξτε διαμέρισμα —</option>
        @for (unit of units(); track unit.id) {
          <option [value]="unit.id">{{ unit.label }} — {{ unit.millimes }}‰</option>
        }
      </select>
      @if (units().length === 0 && !loadingUnits()) {
        <p class="mt-2 text-xs text-slate-500">Δεν υπάρχουν διαμερίσματα. Δημιουργήστε πρώτα από «Διαμερίσματα».</p>
      }
    </div>

    @if (selectedUnitId()) {
      <div class="grid gap-6 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <div class="card p-0 overflow-x-auto">
            <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 class="card-title !mb-0">Ένοικοι διαμερίσματος</h2>
              <span class="text-xs text-slate-500">{{ occupants().length }} εγγραφές</span>
            </div>

            @if (loadingOccupants()) {
              <div class="p-6 text-sm text-slate-500">Φόρτωση…</div>
            } @else {
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Χρήστης</th>
                    <th>Τύπος</th>
                    <th class="text-center">Ψήφος</th>
                    <th>Ρόλος</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (occ of occupants(); track occ.id) {
                    <tr>
                      <td>
                        <div class="font-medium">
                          {{ occ.user?.firstName ?? '' }} {{ occ.user?.lastName ?? '' }}
                          @if (!occ.user?.firstName) {
                            <span class="font-mono text-xs">{{ occ.userId.slice(0,8) }}</span>
                          }
                        </div>
                        <div class="text-xs text-slate-500">{{ occ.user?.email ?? occ.userId }}</div>
                        <div class="text-xs text-slate-400">{{ occ.shareMillimes }}‰</div>
                      </td>
                      <td>
                        <span
                          class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold"
                          [class]="badge(occ.occupantType).cls"
                        >{{ badge(occ.occupantType).label }}</span>
                      </td>
                      <td class="text-center">
                        <label class="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            [checked]="occ.votingEligible"
                            (change)="toggleVotingEligible(occ)"
                          />
                          <span class="text-xs" [class.text-slate-400]="!occ.votingEligible">
                            {{ occ.votingEligible ? 'ΝΑΙ' : 'ΟΧΙ' }}
                          </span>
                        </label>
                      </td>
                      <td class="text-xs text-slate-600">{{ occ.residentRole ?? '—' }}</td>
                      <td class="text-right">
                        <span class="text-xs text-slate-400">{{ occ.periodStart ?? '—' }}</span>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="5" class="py-8 text-center text-sm text-slate-500">
                        Κανένας ένοικος για αυτό το διαμέρισμα.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>

          <form [formGroup]="form" (ngSubmit)="saveOccupancy()" class="card mt-6 flex flex-col gap-4">
            <h3 class="card-title">Καταχώρηση / ενημέρωση ενοίκου</h3>
            <p class="text-xs text-slate-500">Upsert: αν υπάρχει εγγραφή για το ζεύγος (διαμέρισμα, χρήστης) ενημερώνεται, αλλιώς δημιουργείται.</p>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label class="label" for="userId">User ID</label>
                <input id="userId" type="text" class="input font-mono" formControlName="userId" placeholder="cuid του χρήστη" />
                @if (submitted() && form.controls.userId.invalid) {
                  <p class="field-error">Απαιτείται userId.</p>
                }
                <p class="mt-1 text-xs text-slate-400">Βλ. «Κατάλογος» για τα διαθέσιμα IDs. Ο χρήστης πρέπει να ανήκει στην ίδια πολυκατοικία.</p>
              </div>

              <div>
                <label class="label" for="occupantType">Τύπος ενοίκου</label>
                <select id="occupantType" class="input" formControlName="occupantType">
                  <option value="OWNER">OWNER — Ιδιοκτήτης</option>
                  <option value="TENANT">TENANT — Ενοικιαστής</option>
                </select>
              </div>

              <div class="flex items-end gap-3">
                <label class="inline-flex items-center gap-2 pb-2">
                  <input type="checkbox" class="h-4 w-4 rounded" formControlName="votingEligible" />
                  <span class="text-sm font-medium">Δικαίωμα ψήφου</span>
                </label>
              </div>

              <div>
                <label class="label" for="residentRole">residentRole (προαιρετικό)</label>
                <input id="residentRole" type="text" class="input" formControlName="residentRole" placeholder="π.χ. RESIDENT" />
              </div>

              <div>
                <label class="label" for="shareMillimes">shareMillimes (προαιρετικό)</label>
                <input id="shareMillimes" type="number" class="input" formControlName="shareMillimes" min="1" />
              </div>

              <div class="sm:col-span-2">
                <label class="label" for="periodStart">periodStart (ISO, προαιρετικό)</label>
                <input id="periodStart" type="datetime-local" class="input" formControlName="periodStart" />
              </div>
            </div>

            <div class="flex items-center gap-3">
              <button type="submit" class="btn btn-primary" [disabled]="saving()">
                {{ saving() ? 'Αποθήκευση…' : 'Αποθήκευση' }}
              </button>
              @if (formSavedAt(); as at) {
                <span class="text-xs text-slate-500">Αποθηκεύτηκε {{ at }}</span>
              }
            </div>
          </form>
        </div>

        <div class="space-y-6">
          <div class="card">
            <h2 class="card-title">Κανόνες ψηφοφορίας</h2>
            <p class="mb-3 text-xs text-slate-500">Καθορίστε ποιοι τύποι (OWNER/TENANT) ψηφίζουν ανά κατηγορία. Το <code>requiresMillimes</code> επιλέγει βάρος χιλιοστών vs κεφαλών.</p>

            @if (loadingRules()) {
              <p class="text-sm text-slate-500">Φόρτωση κανόνων…</p>
            } @else {
              <div class="space-y-4">
                @for (cat of categories; track cat) {
                  <div class="rounded-lg border border-slate-200 p-3">
                    <div class="mb-2 flex items-center justify-between">
                      <span class="text-sm font-semibold">{{ categoryLabel(cat) }}</span>
                      <span class="text-xs text-slate-400">{{ cat }}</span>
                    </div>

                    <div class="mb-2 flex flex-wrap gap-2">
                      @for (type of occupantTypes; track type) {
                        <label class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
                          [class.border-indigo-300]="isAllowed(cat, type)"
                          [class.bg-indigo-50]="isAllowed(cat, type)"
                        >
                          <input
                            type="checkbox"
                            class="h-3.5 w-3.5 rounded"
                            [checked]="isAllowed(cat, type)"
                            (change)="toggleAllowed(cat, type)"
                          />
                          {{ type }}
                        </label>
                      }
                    </div>

                    <label class="flex items-center justify-between gap-2 text-xs">
                      <span>requiresMillimes (βάρος χιλιοστών)</span>
                      <input
                        type="checkbox"
                        class="h-4 w-4 rounded"
                        [checked]="requiresMillimes(cat)"
                        (change)="toggleMillimes(cat)"
                      />
                    </label>
                    <div class="mt-1 text-xs text-slate-500">
                      {{ allowedLabel(cat) }} · {{ requiresMillimes(cat) ? 'Μέτρηση με χιλιοστά' : 'Κεφαλική (HEADCOUNT)' }}
                    </div>
                  </div>
                }
              </div>
            }
            <p class="mt-3 text-xs text-slate-400">Αποθηκεύεται αυτόματα κατά την αλλαγή. Default: μόνο OWNER, με χιλιοστά.</p>
          </div>

          <div class="card bg-slate-50 text-xs text-slate-600">
            <h3 class="mb-2 font-semibold text-slate-700">Σημείωση ενοικιαστή</h3>
            <p>Οι ένοικοι με <span class="font-semibold">TENANT</span> και <code>votingEligible=false</code> αποκλείονται από την καταμέτρηση. Η μέθοδος <code>computeEligibleTally</code> φιλτράρει τα ballots αναλόγως· η <code>checkCanVote</code> ελέγχει μεμονωμένη ψήφο.</p>
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminOccupancyPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly tenancyApi = inject(TenancyApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly units = signal<UnitWithOwners[]>([]);
  protected readonly occupants = signal<OccupancyDto[]>([]);
  protected readonly rules = signal<VotingEligibilityRuleDto[]>([]);

  protected readonly loadingUnits = signal(true);
  protected readonly loadingOccupants = signal(false);
  protected readonly loadingRules = signal(true);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly formSavedAt = signal<string | null>(null);

  protected readonly selectedUnitId = signal<string>('');
  protected readonly categories = [...CATEGORIES] as const;
  protected readonly occupantTypes: ('OWNER' | 'TENANT')[] = ['OWNER', 'TENANT'];

  protected readonly form = this.fb.nonNullable.group({
    userId: ['', Validators.required],
    occupantType: ['OWNER' as 'OWNER' | 'TENANT', Validators.required],
    votingEligible: [true],
    residentRole: [''],
    shareMillimes: this.fb.control<number | null>(null),
    periodStart: [''],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => { this.loadError.set(true); return EMPTY; }))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reloadUnits();
        this.reloadRules();
      });
  }

  protected badge(type: 'OWNER' | 'TENANT') {
    return occupantBadge(type);
  }

  protected categoryLabel(cat: string) {
    return eligibilityCategoryLabel(cat as any);
  }

  protected allowedLabel(cat: string) {
    const rule = this.rules().find((r) => r.category === cat);
    return allowedTypesLabel(rule?.allowedTypes ?? ['OWNER']);
  }

  protected isAllowed(cat: string, type: 'OWNER' | 'TENANT'): boolean {
    const rule = this.rules().find((r) => r.category === cat);
    if (!rule) return type === 'OWNER';
    return rule.allowedTypes.includes(type);
  }

  protected requiresMillimes(cat: string): boolean {
    const rule = this.rules().find((r) => r.category === cat);
    return rule?.requiresMillimes ?? true;
  }

  protected onUnitChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.selectedUnitId.set(id);
    if (id) this.reloadOccupants(id);
    else this.occupants.set([]);
  }

  protected toggleVotingEligible(occ: OccupancyDto): void {
    const buildingId = this.buildingId;
    const unitId = this.selectedUnitId();
    if (!buildingId || !unitId) return;
    this.tenancyApi
      .setOccupancy(buildingId, unitId, {
        userId: occ.userId,
        occupantType: occ.occupantType,
        votingEligible: !occ.votingEligible,
        residentRole: occ.residentRole ?? null,
      })
      .pipe(catchError(() => { this.toast.error('Η αλλαγή απέτυχε.'); return EMPTY; }))
      .subscribe(() => {
        this.toast.success('Ενημερώθηκε το δικαίωμα ψήφου.');
        this.reloadOccupants(unitId);
      });
  }

  protected saveOccupancy(): void {
    this.submitted.set(true);
    const buildingId = this.buildingId;
    const unitId = this.selectedUnitId();
    if (!buildingId || !unitId || this.form.invalid || this.saving()) return;

    const raw = this.form.getRawValue();
    const dto: any = {
      userId: raw.userId.trim(),
      occupantType: raw.occupantType,
      votingEligible: raw.votingEligible,
      residentRole: raw.residentRole.trim() || null,
      shareMillimes: raw.shareMillimes ?? undefined,
      periodStart: raw.periodStart ? new Date(raw.periodStart).toISOString() : undefined,
    };

    this.saving.set(true);
    this.tenancyApi.setOccupancy(buildingId, unitId, dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.formSavedAt.set(new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }));
        this.submitted.set(false);
        this.toast.success('Η καταχώρηση αποθηκεύτηκε.');
        this.reloadOccupants(unitId);
      },
      error: (err: any) => {
        this.saving.set(false);
        const msg = err?.status === 403 ? 'Δεν έχετε δικαίωμα ή ο χρήστης ανήκει σε άλλο κτίριο.' : err?.status === 404 ? 'Διαμέρισμα ή χρήστης δεν βρέθηκε.' : 'Η αποθήκευση απέτυχε.';
        this.toast.error(msg);
      },
    });
  }

  protected toggleAllowed(cat: string, type: 'OWNER' | 'TENANT'): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    const rule = this.rules().find((r) => r.category === cat);
    const current = rule?.allowedTypes ?? ['OWNER'];
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    if (next.length === 0) {
      this.toast.error('Πρέπει να επιτραπεί τουλάχιστον ένας τύπος.');
      return;
    }
    this.tenancyApi.upsertRule(buildingId, {
      category: cat as any,
      allowedTypes: next as any,
      requiresMillimes: rule?.requiresMillimes ?? true,
    }).pipe(catchError(() => { this.toast.error('Αποθήκευση κανόνα απέτυχε.'); return EMPTY; }))
      .subscribe(() => this.reloadRules());
  }

  protected toggleMillimes(cat: string): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    const rule = this.rules().find((r) => r.category === cat);
    const next = !(rule?.requiresMillimes ?? true);
    const allowed = rule?.allowedTypes ?? ['OWNER'];
    this.tenancyApi.upsertRule(buildingId, {
      category: cat as any,
      allowedTypes: allowed as any,
      requiresMillimes: next,
    }).pipe(catchError(() => { this.toast.error('Αποθήκευση κανόνα απέτυχε.'); return EMPTY; }))
      .subscribe(() => this.reloadRules());
  }

  private reloadUnits(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loadingUnits.set(true);
    this.unitsApi.list(buildingId).pipe(
      catchError(() => { this.loadError.set(true); this.loadingUnits.set(false); return EMPTY; })
    ).subscribe((units) => {
      this.units.set(units);
      this.loadingUnits.set(false);
    });
  }

  private reloadOccupants(unitId: string): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loadingOccupants.set(true);
    this.tenancyApi.occupants(buildingId, unitId).pipe(
      catchError(() => { this.toast.error('Φόρτωση ενοίκων απέτυχε.'); this.loadingOccupants.set(false); return EMPTY; })
    ).subscribe((occupants) => {
      this.occupants.set(occupants);
      this.loadingOccupants.set(false);
    });
  }

  private reloadRules(): void {
    const buildingId = this.buildingId;
    if (!buildingId) return;
    this.loadingRules.set(true);
    this.tenancyApi.rules(buildingId).pipe(
      catchError(() => { this.loadingRules.set(false); return EMPTY; })
    ).subscribe((rules) => {
      this.rules.set(rules);
      this.loadingRules.set(false);
    });
  }
}
