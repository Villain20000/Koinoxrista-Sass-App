import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import type { PartnerLeadDto, PartnerSummaryDto } from '@org/shared';
import { PARTNER_CATEGORIES } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { PartnersApiService } from '../../core/api/partners-api.service';
import { eurosToCents, formatEuros } from '../../ui/format';
import { ToastService } from '../../ui/toast.service';

/** Client mirror of the API forward-only pipeline (NEW→CONTACTED→QUOTED→{WON|LOST}). */
type LeadStatus = 'NEW' | 'CONTACTED' | 'QUOTED' | 'WON' | 'LOST';

const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'Νέο',
  CONTACTED: 'Σε επικοινωνία',
  QUOTED: 'Με προσφορά',
  WON: 'Κερδήθηκε',
  LOST: 'Χαμένο',
};

const STATUS_BADGES: Record<LeadStatus, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  CONTACTED: 'bg-blue-100 text-blue-700',
  QUOTED: 'bg-amber-100 text-amber-800',
  WON: 'bg-green-100 text-green-700',
  LOST: 'bg-red-100 text-red-700',
};

const NEXT_STATUSES: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ['CONTACTED'],
  CONTACTED: ['QUOTED'],
  QUOTED: ['WON', 'LOST'],
  WON: [],
  LOST: [],
};

const CATEGORY_LABELS: Record<string, string> = {
  INSURANCE: 'Ασφάλιση κτιρίου (Ν.4756/2020)',
  ELEVATOR: 'Συντήρηση ανελκυστήρων',
  ENERGY: 'Ενεργειακός επιθεωρητής',
  OTHER: 'Λοιποί συνεργάτες',
};

interface KanbanColumn {
  status: LeadStatus;
  label: string;
  badgeClass: string;
  leads: PartnerLeadDto[];
}

interface SummaryBar {
  label: string;
  cents: number;
  pct: number;
}

/** Pure helper: bar percentage relative to the max value (0 when empty). */
export function pctOfMax(cents: number, maxCents: number): number {
  if (maxCents <= 0) return 0;
  return Math.max(2, Math.round((cents / maxCents) * 100));
}

@Component({
  selector: 'app-admin-partners',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-slate-900">Συνεργάτες &amp; προμήθειες</h1>
      <div class="flex flex-wrap gap-1" role="group" aria-label="Φίλτρο κατηγορίας">
        <button
          type="button"
          class="btn !border-transparent !px-3 !py-1 text-xs"
          [class.bg-slate-900]="category() === ''"
          [class.text-white]="category() === ''"
          (click)="selectCategory('')"
        >
          Όλες
        </button>
        @for (chip of categoryChips; track chip.value) {
          <button
            type="button"
            class="btn !border-transparent !px-3 !py-1 text-xs"
            [class.bg-slate-900]="category() === chip.value"
            [class.text-white]="category() === chip.value"
            (click)="selectCategory(chip.value)"
          >
            {{ chip.label }}
          </button>
        }
      </div>
    </div>

    @if (summary(); as data) {
      <section class="card mb-6" aria-label="Ετήσια σύνοψη προμηθειών">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="card-title">Προμήθειες {{ year() }}</h2>
          <div class="flex items-center gap-1">
            <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="shiftYear(-1)">‹</button>
            <span class="text-sm font-medium">{{ year() }}</span>
            <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="shiftYear(1)">›</button>
          </div>
        </div>
        <p class="stat-value mt-1 text-green-700">{{ euros(data.totalWonCents) }}</p>
        <p class="text-xs text-slate-500">Σύνολο πραγματοποιηθέντων προμηθειών (κερδημένα)</p>

        <div class="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ανά μήνα
            </h3>
            @for (bar of monthBars(); track bar.label) {
              <div class="mb-2">
                <div class="mb-1 flex justify-between text-xs text-slate-600">
                  <span>{{ bar.label }}</span>
                  <span>{{ euros(bar.cents) }}</span>
                </div>
                <div class="h-2 w-full rounded bg-slate-200">
                  <div class="h-2 rounded bg-green-500" [style.width.%]="bar.pct"></div>
                </div>
              </div>
            } @empty {
              <p class="text-sm text-slate-500">Καμία προμήθεια ακόμη.</p>
            }
          </div>
          <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ανά κατηγορία
            </h3>
            @for (bar of categoryBars(); track bar.label) {
              <div class="mb-2">
                <div class="mb-1 flex justify-between text-xs text-slate-600">
                  <span>{{ bar.label }}</span>
                  <span>{{ euros(bar.cents) }}</span>
                </div>
                <div class="h-2 w-full rounded bg-slate-200">
                  <div class="h-2 rounded bg-blue-400" [style.width.%]="bar.pct"></div>
                </div>
              </div>
            } @empty {
              <p class="text-sm text-slate-500">Κανένα κερδημένο lead.</p>
            }
          </div>
        </div>
      </section>
    }

    <div class="grid gap-6 xl:grid-cols-4">
      <div class="card xl:col-span-1">
        <h2 class="card-title">Νέο referral</h2>
        <form [formGroup]="form" (ngSubmit)="create()" class="flex flex-col gap-3">
          <div>
            <label class="label" for="partnerName">Συνεργάτης</label>
            <input
              id="partnerName"
              type="text"
              class="input"
              formControlName="partnerName"
              placeholder="π.χ. Ασφαλιστικός Σύμβουλος ΑΕ"
            />
            @if (submitted() && form.controls.partnerName.invalid) {
              <p class="field-error">Το όνομα χρειάζεται τουλάχιστον 2 χαρακτήρες.</p>
            }
          </div>
          <div>
            <label class="label" for="category">Κατηγορία</label>
            <select id="category" class="input" formControlName="category">
              @for (option of categoryOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="contactName">Επικοινωνία (όνομα)</label>
            <input id="contactName" type="text" class="input" formControlName="contactName" />
          </div>
          <div>
            <label class="label" for="contactEmail">Email</label>
            <input id="contactEmail" type="email" class="input" formControlName="contactEmail" />
            @if (submitted() && form.controls.contactEmail.invalid) {
              <p class="field-error">Μη έγκυρο email.</p>
            }
          </div>
          <div>
            <label class="label" for="contactPhone">Τηλέφωνο</label>
            <input id="contactPhone" type="tel" class="input" formControlName="contactPhone" />
          </div>
          <div>
            <label class="label" for="expected"> Συμφωνημένη προμήθεια € </label>
            <input
              id="expected"
              type="number"
              min="0"
              step="0.01"
              class="input"
              formControlName="expectedEuros"
            />
            @if (submitted() && form.controls.expectedEuros.invalid) {
              <p class="field-error">Δώστε έγκυρο ποσό.</p>
            }
          </div>
          <div>
            <label class="label" for="notes">Σημειώσεις</label>
            <textarea id="notes" rows="2" class="input" formControlName="notes"></textarea>
          </div>
          <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
            Προσθήκη
          </button>
        </form>
      </div>

      <div class="xl:col-span-3">
        @if (loadError()) {
          <div class="card border-red-200 bg-red-50 text-sm text-red-700">
            Αποτυχία φόρτωσης leads. Δοκιμάστε ξανά.
          </div>
        }
        <div class="grid gap-3 md:grid-cols-3 2xl:grid-cols-5">
          @for (column of columns(); track column.status) {
            <section class="rounded-lg bg-slate-50 p-3" [attr.aria-label]="column.label">
              <header class="mb-3 flex items-center justify-between">
                <h3 class="text-sm font-semibold text-slate-700">{{ column.label }}</h3>
                <span class="badge {{ column.badgeClass }}">{{ column.leads.length }}</span>
              </header>
              <div class="flex flex-col gap-2">
                @for (lead of column.leads; track lead.id) {
                  <button
                    type="button"
                    class="w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
                    (click)="open(lead)"
                  >
                    <span class="block text-sm font-medium text-slate-900">
                      {{ lead.partnerName }}
                    </span>
                    <span class="mt-0.5 block text-xs text-slate-500">
                      {{ categoryLabel(lead.category) }}
                    </span>
                    <span class="mt-1 block text-xs font-medium text-slate-700">
                      {{ euros(lead.actualCommissionCents ?? lead.expectedCommissionCents) }}
                    </span>
                  </button>
                } @empty {
                  <p class="py-2 text-xs text-slate-400">—</p>
                }
              </div>
            </section>
          }
        </div>
      </div>
    </div>

    @if (selected(); as lead) {
      <div
        class="fixed inset-0 z-40 flex justify-end bg-slate-900/40"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        (click)="close()"
        (keydown.escape)="close()"
      >
        <div
          class="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl"
          role="document"
          tabindex="0"
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
        >
          <div class="mb-4 flex items-start justify-between gap-2">
            <div>
              <h2 class="text-lg font-bold text-slate-900">{{ lead.partnerName }}</h2>
              <p class="text-sm text-slate-500">{{ categoryLabel(lead.category) }}</p>
            </div>
            <span class="badge {{ statusBadge(lead.status) }}">
              {{ statusLabel(lead.status) }}
            </span>
          </div>

          <dl class="mb-5 space-y-1 text-sm text-slate-600">
            @if (lead.contactName) {
              <div><dt class="inline font-medium">Επικοινωνία: </dt><dd class="inline">{{ lead.contactName }}</dd></div>
            }
            @if (lead.contactEmail) {
              <div><dt class="inline font-medium">Email: </dt><dd class="inline">{{ lead.contactEmail }}</dd></div>
            }
            @if (lead.contactPhone) {
              <div><dt class="inline font-medium">Τηλ: </dt><dd class="inline">{{ lead.contactPhone }}</dd></div>
            }
            <div>
              <dt class="inline font-medium">Συμφωνημένη προμήθεια: </dt>
              <dd class="inline">{{ euros(lead.expectedCommissionCents) }}</dd>
            </div>
            @if (lead.actualCommissionCents !== null) {
              <div class="font-medium text-green-700">
                Πραγματοποιηθείσα: {{ euros(lead.actualCommissionCents) }}
              </div>
            }
            @if (lead.notes) {
              <div><dt class="inline font-medium">Σημειώσεις: </dt><dd class="inline">{{ lead.notes }}</dd></div>
            }
          </dl>

          <section class="mb-5">
            <h3 class="mb-2 text-sm font-semibold text-slate-900">Επόμενο βήμα</h3>
            @if (nextOf(lead.status).length > 0) {
              <div class="flex flex-wrap items-center gap-2">
                @for (target of nextOf(lead.status); track target) {
                  <button
                    type="button"
                    class="btn btn-secondary !px-3 !py-1 text-xs"
                    [disabled]="transitioning()"
                    (click)="advance(lead, target)"
                  >
                    → {{ statusLabel(target) }}
                  </button>
                }
              </div>
              @if (nextOf(lead.status).includes('WON')) {
                <div class="mt-2">
                  <label class="label" for="actualCommission">Πραγματική προμήθεια € (υποχρεωτικό για «Κερδήθηκε»)</label>
                  <input
                    id="actualCommission"
                    type="number"
                    min="0"
                    step="0.01"
                    class="input"
                    [value]="wonAmount()"
                    (input)="wonAmountSet($event)"
                  />
                  @if (amountError()) {
                    <p class="field-error">Δώστε έγκυρη πραγματική προμήθεια (≥ 0).</p>
                  }
                </div>
              }
            } @else {
              <p class="text-sm text-slate-500">Οριστικό στάδιο — δεν υπάρχουν περαιτέρω μεταβάσεις.</p>
            }
          </section>

          <section class="mb-5">
            <h3 class="mb-2 text-sm font-semibold text-slate-900">Επεξεργασία</h3>
            <form [formGroup]="editForm" (ngSubmit)="saveEdit()" class="flex flex-col gap-3">
              <div>
                <label class="label" for="editPartnerName">Συνεργάτης</label>
                <input id="editPartnerName" type="text" class="input" formControlName="partnerName" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="editCategory">Κατηγορία</label>
                  <select id="editCategory" class="input" formControlName="category">
                    @for (option of categoryOptions; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label class="label" for="editContactName">Επικοινωνία</label>
                  <input id="editContactName" type="text" class="input" formControlName="contactName" />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="editExpected">Συμφωνημένη €</label>
                  <input id="editExpected" type="number" min="0" step="0.01" class="input" formControlName="expectedEuros" />
                </div>
                <div>
                  <label class="label" for="editActual">Πραγματική € (προαιρετικό)</label>
                  <input id="editActual" type="number" min="0" step="0.01" class="input" formControlName="actualEuros" />
                </div>
              </div>
              <div>
                <label class="label" for="editNotes">Σημειώσεις</label>
                <textarea id="editNotes" rows="2" class="input" formControlName="notes"></textarea>
              </div>
              <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
                Αποθήκευση
              </button>
            </form>
          </section>

          <div class="flex items-center justify-between">
            @if (lead.status === 'NEW') {
              <button
                type="button"
                class="btn btn-secondary !px-3 !py-1 text-xs text-red-600"
                (click)="remove(lead)"
              >
                Διαγραφή
              </button>
            } @else {
              <span></span>
            }
            <button type="button" class="btn btn-secondary" (click)="close()">Κλείσιμο</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminPartnersPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly partnersApi = inject(PartnersApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;

  protected readonly statuses: readonly LeadStatus[] = [
    'NEW',
    'CONTACTED',
    'QUOTED',
    'WON',
    'LOST',
  ];

  protected readonly categoryChips = PARTNER_CATEGORIES.map((value) => ({
    value,
    label: CATEGORY_LABELS[value] ?? value,
  }));

  protected readonly categoryOptions = this.categoryChips;

  protected readonly leads = signal<PartnerLeadDto[]>([]);
  protected readonly summary = signal<PartnerSummaryDto | null>(null);
  protected readonly category = signal('');
  protected readonly year = signal(new Date().getUTCFullYear());
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly transitioning = signal(false);
  protected readonly amountError = signal(false);
  protected readonly wonAmount = signal('');
  protected readonly selected = signal<PartnerLeadDto | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    partnerName: ['', [Validators.required, Validators.minLength(2)]],
    category: this.fb.nonNullable.control<string>('INSURANCE'),
    contactName: [''],
    contactEmail: ['', Validators.email],
    contactPhone: [''],
    expectedEuros: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
    notes: [''],
  });

  protected readonly editForm = this.fb.nonNullable.group({
    partnerName: ['', [Validators.required, Validators.minLength(2)]],
    category: this.fb.nonNullable.control<string>('INSURANCE'),
    contactName: [''],
    expectedEuros: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
    actualEuros: this.fb.nonNullable.control<number | null>(null),
    notes: [''],
  });

  private buildingId: string | null = null;

  protected readonly columns = computed<KanbanColumn[]>(() =>
    this.statuses.map((status) => ({
      status,
      label: STATUS_LABELS[status],
      badgeClass: STATUS_BADGES[status],
      leads: this.leads().filter((lead) => lead.status === status),
    })),
  );

  protected readonly monthBars = computed<SummaryBar[]>(() => {
    const byMonth = this.summary()?.byMonth ?? [];
    const max = Math.max(...byMonth.map((m) => m.commissionCents), 0);
    return byMonth.map((m) => ({
      label: m.month,
      cents: m.commissionCents,
      pct: pctOfMax(m.commissionCents, max),
    }));
  });

  protected readonly categoryBars = computed<SummaryBar[]>(() => {
    const byCategory = this.summary()?.byCategory ?? [];
    const max = Math.max(...byCategory.map((c) => c.commissionCents), 0);
    return byCategory.map((c) => ({
      label: this.categoryLabel(c.category),
      cents: c.commissionCents,
      pct: pctOfMax(c.commissionCents, max),
    }));
  });

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected selectCategory(category: string): void {
    if (this.category() === category) return;
    this.category.set(category);
    this.reloadLeads();
  }

  protected shiftYear(delta: number): void {
    this.year.set(this.year() + delta);
    this.reloadSummary();
  }

  protected statusLabel(status: string): string {
    return STATUS_LABELS[status as LeadStatus] ?? status;
  }

  protected statusBadge(status: string): string {
    return STATUS_BADGES[status as LeadStatus] ?? 'bg-slate-100 text-slate-700';
  }

  protected categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category;
  }

  /** Allowed next steps only — mirrors the server's forward-only pipeline. */
  protected nextOf(status: string): readonly LeadStatus[] {
    return NEXT_STATUSES[status as LeadStatus] ?? [];
  }

  protected open(lead: PartnerLeadDto): void {
    this.selected.set(lead);
    this.amountError.set(false);
    this.wonAmount.set(
      lead.actualCommissionCents !== null
        ? String(lead.actualCommissionCents / 100)
        : String((lead.expectedCommissionCents / 100).toFixed(2)),
    );
    this.editForm.patchValue({
      partnerName: lead.partnerName,
      category: lead.category,
      contactName: lead.contactName ?? '',
      expectedEuros: lead.expectedCommissionCents / 100,
      actualEuros:
        lead.actualCommissionCents === null ? null : lead.actualCommissionCents / 100,
      notes: lead.notes ?? '',
    });
  }

  protected close(): void {
    this.selected.set(null);
  }

  protected wonAmountSet(event: Event): void {
    this.wonAmount.set((event.target as HTMLInputElement).value);
    this.amountError.set(false);
  }

  protected create(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    const value = this.form.getRawValue();
    const expectedCents = eurosToCents(value.expectedEuros ?? NaN);
    if (!Number.isFinite(expectedCents) || expectedCents < 0) return;

    const payload = {
      partnerName: value.partnerName.trim(),
      category: value.category,
      ...(value.contactName.trim() ? { contactName: value.contactName.trim() } : {}),
      ...(value.contactEmail.trim() ? { contactEmail: value.contactEmail.trim() } : {}),
      ...(value.contactPhone.trim() ? { contactPhone: value.contactPhone.trim() } : {}),
      expectedCommissionCents: expectedCents,
      ...(value.notes.trim() ? { notes: value.notes.trim() } : {}),
    };

    this.saving.set(true);
    this.partnersApi
      .create(this.buildingId, payload)
      .pipe(catchError(() => EMPTY))
      .subscribe({
        next: () => {
          this.toast.success('Το referral καταχωρήθηκε.');
          this.saving.set(false);
          this.submitted.set(false);
          this.form.reset({
            partnerName: '',
            category: 'INSURANCE',
            contactName: '',
            contactEmail: '',
            contactPhone: '',
            expectedEuros: null,
            notes: '',
          });
          this.reload();
        },
        error: () => {
          this.toast.error('Η καταχώρηση απέτυχε.');
          this.saving.set(false);
        },
      });
  }

  protected advance(lead: PartnerLeadDto, target: LeadStatus): void {
    if (this.transitioning()) return;
    const dto =
      target === 'WON'
        ? this.wonPayload()
        : { status: target };
    if (dto === null) {
      this.amountError.set(true);
      return;
    }

    this.transitioning.set(true);
    this.partnersApi
      .changeStatus(lead.id, dto)
      .pipe(catchError(() => EMPTY))
      .subscribe({
        next: () => {
          this.transitioning.set(false);
          this.toast.success(`Μετακινήθηκε σε: ${STATUS_LABELS[target]}`);
          this.close();
          this.reload();
        },
        error: () => {
          this.transitioning.set(false);
          this.toast.error('Η μεταβολή κατάστασης απέτυχε.');
        },
      });
  }

  private wonPayload(): { status: 'WON'; actualCommissionCents: number } | null {
    const cents = eurosToCents(this.wonAmount() || NaN);
    if (!Number.isFinite(cents) || cents < 0) return null;
    return { status: 'WON', actualCommissionCents: cents };
  }

  protected saveEdit(): void {
    const lead = this.selected();
    if (!lead || this.editForm.invalid || this.saving()) return;
    const value = this.editForm.getRawValue();
    const expectedCents = eurosToCents(value.expectedEuros ?? NaN);
    if (!Number.isFinite(expectedCents) || expectedCents < 0) return;

    const payload: Record<string, unknown> = {
      partnerName: value.partnerName.trim(),
      category: value.category,
      contactName: value.contactName.trim(),
      expectedCommissionCents: expectedCents,
      notes: value.notes.trim(),
    };
    if (value.actualEuros !== null) {
      const actualCents = eurosToCents(value.actualEuros);
      if (!Number.isFinite(actualCents) || actualCents < 0) return;
      payload['actualCommissionCents'] = actualCents;
    }

    this.saving.set(true);
    this.partnersApi
      .update(lead.id, payload)
      .pipe(catchError(() => EMPTY))
      .subscribe({
        next: () => {
          this.toast.success('Οι αλλαγές αποθηκεύτηκαν.');
          this.saving.set(false);
          this.close();
          this.reload();
        },
        error: () => {
          this.toast.error('Η αποθήκευση απέτυχε.');
          this.saving.set(false);
        },
      });
  }

  protected remove(lead: PartnerLeadDto): void {
    this.partnersApi
      .delete(lead.id)
      .pipe(catchError(() => EMPTY))
      .subscribe(() => {
        this.toast.info(`Διαγράφηκε: ${lead.partnerName}`);
        this.close();
        this.reload();
      });
  }

  protected reload(): void {
    this.reloadLeads();
    this.reloadSummary();
  }

  private reloadLeads(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    this.loading.set(true);
    const category = this.category();
    this.partnersApi
      .list(this.buildingId, undefined, category || undefined)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((leads) => {
        this.leads.set(leads);
        this.loading.set(false);
      });
  }

  private reloadSummary(): void {
    if (!this.buildingId) return;
    this.partnersApi
      .summary(this.buildingId, this.year())
      .pipe(catchError(() => EMPTY))
      .subscribe((summary) => this.summary.set(summary));
  }
}
