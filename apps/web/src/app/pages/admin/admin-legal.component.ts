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
  ArrearsReport,
  LegalCaseDto,
  LegalEventDto,
  LegalStatsDto,
} from '@org/shared';
import {
  LEGAL_STAGES,
  LEGAL_STATUSES,
  legalStageBadgeClass,
  legalStageLabel,
  legalStatusBadgeClass,
  legalStatusLabel,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { LegalApiService } from '../../core/api/legal-api.service';
import { UnitsApiService, UnitWithOwners } from '../../core/api/units-api.service';
import { ToastService } from '../../ui/toast.service';
import { formatEuros } from '../../ui/format';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface InvoiceLite {
  id: string;
  unitId: string;
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
  status: string;
}

function nextStageOf(stage: string): string | null {
  const order = LEGAL_STAGES.indexOf(stage as any);
  if (order === -1 || order >= LEGAL_STAGES.length - 1) return null;
  return LEGAL_STAGES[order + 1];
}

function eventLabel(type: string): string {
  switch (type) {
    case 'CREATED':
      return 'Δημιουργήθηκε';
    case 'NOTICE_SENT':
      return 'Εστάλη εξώδικο';
    case 'ESCALATED':
      return 'Κλιμάκωση';
    case 'CLOSED':
      return 'Κλείσιμο';
    case 'NOTE':
      return 'Σημείωση';
    default:
      return type;
  }
}

function eventBadgeClass(type: string): string {
  switch (type) {
    case 'CREATED':
      return 'bg-slate-100 text-slate-700';
    case 'NOTICE_SENT':
      return 'bg-amber-100 text-amber-800';
    case 'ESCALATED':
      return 'bg-blue-100 text-blue-700';
    case 'CLOSED':
      return 'bg-slate-200 text-slate-600';
    case 'NOTE':
      return 'bg-green-100 text-green-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

@Component({
  selector: 'app-admin-legal',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-slate-900">Νομικές ενέργειες — Εξώδικο → Διαταγή Πληρωμής</h1>
        <p class="mt-1 text-sm text-slate-500">Κλιμάκωση οφειλών: εξώδικο, δικηγόρος, δικαστήριο. Εξώδικο με προθεσμία 15 ημερών.</p>
      </div>
      <button type="button" class="btn btn-primary" (click)="openCreateModal()">+ Νέα υπόθεση</button>
    </div>

    <!-- Stats KPI -->
    @if (stats(); as s) {
      <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card">
          <p class="text-sm text-slate-500">Σύνολο υποθέσεων</p>
          <p class="stat-value mt-1">{{ s.totalCases }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Σύνολο σε νομική διεκδίκηση</p>
          <p class="stat-value mt-1 text-red-700">{{ euros(s.totalOutstandingCents) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Ανά στάδιο</p>
          <div class="mt-2 flex flex-wrap gap-1">
            @for (row of s.byStage; track row.stage) {
              <span class="badge" [class]="stageBadge(row.stage)">{{ stageLabel(row.stage) }}: {{ row.count }}</span>
            } @empty {
              <span class="text-xs text-slate-400">—</span>
            }
          </div>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Ανά κατάσταση</p>
          <div class="mt-2 flex flex-wrap gap-1">
            @for (row of s.byStatus; track row.status) {
              <span class="badge" [class]="statusBadge(row.status)">{{ statusLabel(row.status) }}: {{ row.count }}</span>
            } @empty {
              <span class="text-xs text-slate-400">—</span>
            }
          </div>
        </div>
      </div>
    }

    <!-- Filters -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="label" for="filterStage">Στάδιο</label>
        <select id="filterStage" class="input !w-40" [value]="filterStage()" (change)="onStageFilter($event)">
          <option value="">Όλα τα στάδια</option>
          @for (st of stages; track st) {
            <option [value]="st">{{ stageLabel(st) }}</option>
          }
        </select>
      </div>
      <div>
        <label class="label" for="filterStatus">Κατάσταση</label>
        <select id="filterStatus" class="input !w-40" [value]="filterStatus()" (change)="onStatusFilter($event)">
          <option value="">Όλες οι καταστάσεις</option>
          @for (st of statuses; track st) {
            <option [value]="st">{{ statusLabel(st) }}</option>
          }
        </select>
      </div>
      <button type="button" class="btn btn-secondary" (click)="reload()">Ανανέωση</button>
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">Αποτυχία φόρτωσης υποθέσεων.</div>
    } @else {
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Υπόθεση / Διαμέρισμα</th>
              <th>Στάδιο</th>
              <th>Κατάσταση</th>
              <th>Ποσό</th>
              <th>Τελευταία αποστολή</th>
              <th>Ενημέρωση</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (c of cases(); track c.id) {
              <tr>
                <td>
                  <span class="font-medium">{{ c.title }}</span>
                  <span class="block text-xs text-slate-500">{{ c.unitLabel || c.unitId }} · {{ c.invoiceIds.length }} τιμολόγια</span>
                </td>
                <td><span class="badge" [class]="stageBadge(c.stage)">{{ stageLabel(c.stage) }}</span></td>
                <td><span class="badge" [class]="statusBadge(c.status)">{{ statusLabel(c.status) }}</span></td>
                <td class="font-medium text-red-700">{{ euros(c.totalCents) }}</td>
                <td class="text-xs">{{ c.lastSentAt ? formatDate(c.lastSentAt) : '—' }}</td>
                <td class="text-xs">{{ formatDate(c.updatedAt) }}</td>
                <td class="whitespace-nowrap text-right">
                  <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="openCase(c)">Προβολή</button>
                  <button type="button" class="btn btn-secondary ml-1 !px-2 !py-1 text-xs" (click)="previewExodik(c)">Εξώδικο</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-8 text-center text-sm text-slate-500">Καμία νομική υπόθεση. Δημιουργήστε από ανεξόφλητα τιμολόγια.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- Create modal -->
    @if (showCreate()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" (click)="closeCreateModal()">
        <div class="card w-full max-w-xl" (click)="$event.stopPropagation()">
          <h2 class="card-title">Νέα νομική υπόθεση — επιλογή από οφειλές</h2>
          <form [formGroup]="createForm" (ngSubmit)="createCase()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="createUnit">Διαμέρισμα *</label>
              <select id="createUnit" class="input" formControlName="unitId" (change)="onUnitChange()">
                <option value="" disabled>— Επιλογή —</option>
                @for (u of units(); track u.id) {
                  <option [value]="u.id">{{ u.label }} @if (arrearsMap().get(u.id)) { — {{ euros(arrearsMap().get(u.id)!) }} } </option>
                }
              </select>
              @if (createSubmitted() && createForm.controls.unitId.invalid) { <p class="field-error">Επιλέξτε διαμέρισμα.</p> }
            </div>

            @if (createUnitInvoices().length > 0) {
              <div>
                <label class="label">Τιμολόγια οφειλής *</label>
                <div class="max-h-48 overflow-y-auto rounded border border-slate-200">
                  @for (inv of createUnitInvoices(); track inv.id) {
                    <label class="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                      <input type="checkbox" [checked]="isInvoiceSelected(inv.id)" (change)="toggleInvoice(inv.id)" />
                      <span class="flex-1 text-sm">{{ inv.periodYearMonth }} — {{ euros(inv.totalCents) }} (πληρωμένα {{ euros(inv.paidCents) }}) → <span class="font-medium text-red-700">{{ euros(inv.totalCents - inv.paidCents) }}</span></span>
                    </label>
                  }
                </div>
                <p class="mt-1 text-xs text-slate-500">Επιλεγμένο σύνολο: <span class="font-medium">{{ euros(selectedTotal()) }}</span> — {{ selectedInvoiceIds().size }} τιμολόγια</p>
                @if (createSubmitted() && selectedInvoiceIds().size === 0) { <p class="field-error">Επιλέξτε τουλάχιστον ένα τιμολόγιο.</p> }
              </div>
            } @else if (createForm.controls.unitId.value) {
              <p class="text-sm text-slate-500">Δεν βρέθηκαν ανεξόφλητα τιμολόγια για το διαμέρισμα (δοκιμάστε άλλο).</p>
            }

            <div>
              <label class="label" for="createTitle">Τίτλος (προαιρετικό)</label>
              <input id="createTitle" type="text" class="input" formControlName="title" placeholder="π.χ. Εξώδικο — Α1 — 2026-08" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label" for="lawyerName">Δικηγόρος (προαιρετικό)</label>
                <input id="lawyerName" type="text" class="input" formControlName="lawyerName" />
              </div>
              <div>
                <label class="label" for="lawyerEmail">Email δικηγόρου</label>
                <input id="lawyerEmail" type="email" class="input" formControlName="lawyerEmail" />
                @if (createSubmitted() && createForm.controls.lawyerEmail.invalid) { <p class="field-error">Μη έγκυρο email.</p> }
              </div>
            </div>
            <div>
              <label class="label" for="notes">Σημειώσεις</label>
              <textarea id="notes" rows="2" class="input" formControlName="notes"></textarea>
            </div>
            @if (arrearsMap().get(createForm.controls.unitId.value ?? '') !== undefined) {
              <p class="text-xs text-slate-500">Ανεξόφλητο από αναφορά χρεών: {{ euros(arrearsMap().get(createForm.controls.unitId.value!)!) }}</p>
            }
            <div class="flex gap-2">
              <button type="submit" class="btn btn-primary" [disabled]="creating()">Δημιουργία υπόθεσης (NOTICE)</button>
              <button type="button" class="btn btn-secondary" (click)="closeCreateModal()">Άκυρο</button>
            </div>
          </form>
        </div>
      </div>
    }

    <!-- Detail drawer -->
    @if (selected(); as c) {
      <div class="fixed inset-0 z-40 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true" (click)="closeCase()" (keydown.escape)="closeCase()" tabindex="-1">
        <div class="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl" role="document" tabindex="0" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-bold text-slate-900">{{ c.title }}</h2>
              <p class="text-sm text-slate-500">{{ c.unitLabel || c.unitId }} · {{ c.invoiceIds.length }} τιμολόγια · {{ euros(c.totalCents) }}</p>
              <div class="mt-2 flex gap-1">
                <span class="badge" [class]="stageBadge(c.stage)">{{ stageLabel(c.stage) }}</span>
                <span class="badge" [class]="statusBadge(c.status)">{{ statusLabel(c.status) }}</span>
              </div>
            </div>
            <button type="button" class="btn btn-secondary !px-2 !py-1" (click)="closeCase()">×</button>
          </div>

          @if (c.lawyerName || c.lawyerEmail) {
            <p class="mb-3 text-sm text-slate-600">Δικηγόρος: {{ c.lawyerName || '—' }} @if (c.lawyerEmail) { — {{ c.lawyerEmail }} }</p>
          }
          @if (c.notes) {
            <div class="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">{{ c.notes }}</div>
          }
          @if (c.lastSentAt) {
            <p class="mb-3 text-xs text-slate-500">Τελευταία αποστολή εξωδίκου: {{ formatDate(c.lastSentAt) }}</p>
          }

          <div class="mb-4 flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary !px-3 !py-1 text-sm" [disabled]="sending()" (click)="sendNotice(c)">
              {{ sending() ? 'Αποστολή…' : 'Αποστολή εξωδίκου' }}
            </button>
            <button type="button" class="btn btn-secondary !px-3 !py-1 text-sm" (click)="previewExodik(c)">Προεπισκόπηση HTML</button>
            @if (nextStage(c.stage); as ns) {
              <button type="button" class="btn btn-secondary !px-3 !py-1 text-sm" [disabled]="advancing()" (click)="advanceStage(c, ns)">
                Κλιμάκωση → {{ stageLabel(ns) }}
              </button>
            }
          </div>

          <!-- Add note -->
          <form [formGroup]="noteForm" (ngSubmit)="addNote(c)" class="mb-4 flex gap-2">
            <input type="text" class="input flex-1" formControlName="note" placeholder="Προσθήκη σημείωσης…" />
            <button type="submit" class="btn btn-secondary" [disabled]="noting()">Προσθήκη</button>
          </form>

          <!-- Close -->
          @if (c.stage !== 'CLOSED') {
            <form [formGroup]="closeForm" (ngSubmit)="closeLegalCase(c)" class="mb-4 flex gap-2">
              <input type="text" class="input flex-1" formControlName="reason" placeholder="Αιτία κλεισίματος (προαιρετικό)" />
              <button type="submit" class="btn btn-danger" [disabled]="closing()">Κλείσιμο υπόθεσης</button>
            </form>
          }

          <h3 class="mb-2 text-sm font-semibold text-slate-900">Ιστορικό ({{ (c.events || []).length }})</h3>
          <div class="flex flex-col gap-2">
            @for (ev of (c.events || []); track ev.id) {
              <div class="rounded border border-slate-200 p-3">
                <div class="flex items-center justify-between">
                  <span class="badge !px-2 !py-0 text-xs" [class]="eventBadge(ev.type)">{{ eventLabel(ev.type) }}</span>
                  <span class="text-xs text-slate-500">{{ formatDate(ev.createdAt) }}</span>
                </div>
                @if (ev.payload) {
                  <pre class="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600">{{ payloadText(ev.payload) }}</pre>
                }
              </div>
            } @empty {
              <p class="text-sm text-slate-500">Καμία ενέργεια ακόμη.</p>
            }
          </div>

          <div class="mt-6 flex justify-end">
            <button type="button" class="btn btn-secondary" (click)="closeCase()">Κλείσιμο</button>
          </div>
        </div>
      </div>
    }

    <!-- Exodik preview modal -->
    @if (exodikHtml(); as html) {
      <div class="fixed inset-0 z-50 flex flex-col bg-slate-900/60 p-4" (click)="closeExodik()">
        <div class="mx-auto flex w-full max-w-4xl flex-1 flex-col rounded-lg bg-white shadow-xl" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between border-b border-slate-200 p-3">
            <h2 class="text-sm font-semibold">Προεπισκόπηση εξωδίκου</h2>
            <div class="flex gap-2">
              <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="downloadExodik()">Λήψη HTML</button>
              <button type="button" class="btn btn-secondary !px-2 !py-1" (click)="closeExodik()">×</button>
            </div>
          </div>
          <iframe class="h-full w-full flex-1 rounded-b-lg" [srcdoc]="html" title="Εξώδικο preview"></iframe>
        </div>
      </div>
    }
  `,
})
export class AdminLegalPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly legalApi = inject(LegalApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);

  protected readonly euros = formatEuros;
  protected readonly stageLabel = legalStageLabel;
  protected readonly stageBadge = legalStageBadgeClass;
  protected readonly statusLabel = legalStatusLabel;
  protected readonly statusBadge = legalStatusBadgeClass;
  protected readonly eventLabel = eventLabel;
  protected readonly eventBadge = eventBadgeClass;
  protected readonly stages = LEGAL_STAGES as unknown as string[];
  protected readonly statuses = LEGAL_STATUSES as unknown as string[];

  protected readonly cases = signal<LegalCaseDto[]>([]);
  protected readonly stats = signal<LegalStatsDto | null>(null);
  protected readonly units = signal<UnitWithOwners[]>([]);
  protected readonly arrearsMap = signal<Map<string, number>>(new Map());
  protected readonly allInvoices = signal<InvoiceLite[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly filterStage = signal('');
  protected readonly filterStatus = signal('');
  protected readonly selected = signal<LegalCaseDto | null>(null);
  protected readonly exodikHtml = signal<string | null>(null);
  protected readonly showCreate = signal(false);
  protected readonly createSubmitted = signal(false);
  protected readonly creating = signal(false);
  protected readonly sending = signal(false);
  protected readonly advancing = signal(false);
  protected readonly noting = signal(false);
  protected readonly closing = signal(false);

  protected readonly selectedInvoiceIds = signal<Set<string>>(new Set());

  protected readonly createForm = this.fb.nonNullable.group({
    unitId: ['', Validators.required],
    title: [''],
    lawyerName: [''],
    lawyerEmail: ['', Validators.email],
    notes: [''],
  });

  protected readonly noteForm = this.fb.nonNullable.group({
    note: ['', [Validators.required, Validators.minLength(1)]],
  });

  protected readonly closeForm = this.fb.nonNullable.group({
    reason: [''],
  });

  protected readonly createUnitInvoices = computed(() => {
    const unitId = this.createForm.controls.unitId.value;
    if (!unitId) return [];
    return this.allInvoices()
      .filter((inv) => inv.unitId === unitId && inv.totalCents - inv.paidCents > 0)
      .sort((a, b) => (a.periodYearMonth < b.periodYearMonth ? -1 : 1));
  });

  protected readonly selectedTotal = computed(() => {
    const ids = this.selectedInvoiceIds();
    let total = 0;
    for (const inv of this.createUnitInvoices()) {
      if (ids.has(inv.id)) total += Math.max(0, inv.totalCents - inv.paidCents);
    }
    return total;
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

  protected formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('el-GR');
  }

  protected payloadText(payload: Record<string, unknown>): string {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }

  protected nextStage(stage: string): string | null {
    return nextStageOf(stage);
  }

  protected isInvoiceSelected(id: string): boolean {
    return this.selectedInvoiceIds().has(id);
  }

  protected toggleInvoice(id: string): void {
    const next = new Set(this.selectedInvoiceIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedInvoiceIds.set(next);
  }

  protected onStageFilter(event: Event): void {
    this.filterStage.set((event.target as HTMLSelectElement).value);
    this.reloadCases();
  }

  protected onStatusFilter(event: Event): void {
    this.filterStatus.set((event.target as HTMLSelectElement).value);
    this.reloadCases();
  }

  protected onUnitChange(): void {
    this.selectedInvoiceIds.set(new Set());
  }

  protected openCreateModal(): void {
    this.createSubmitted.set(false);
    this.createForm.reset({ unitId: '', title: '', lawyerName: '', lawyerEmail: '', notes: '' });
    this.selectedInvoiceIds.set(new Set());
    this.showCreate.set(true);
  }

  protected closeCreateModal(): void {
    this.showCreate.set(false);
  }

  protected openCase(c: LegalCaseDto): void {
    // fetch fresh with events
    if (!this.buildingId) return;
    this.legalApi
      .getCase(this.buildingId, c.id)
      .pipe(catchError(() => EMPTY))
      .subscribe((fresh) => this.selected.set(fresh));
  }

  protected closeCase(): void {
    this.selected.set(null);
  }

  protected previewExodik(c: LegalCaseDto): void {
    if (!this.buildingId) return;
    this.legalApi
      .getExodikHtml(this.buildingId, c.id)
      .pipe(
        catchError(() => {
          this.toast.error('Η προεπισκόπηση απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe((html) => this.exodikHtml.set(html));
  }

  protected closeExodik(): void {
    this.exodikHtml.set(null);
  }

  protected downloadExodik(): void {
    const html = this.exodikHtml();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exodik.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  protected createCase(): void {
    this.createSubmitted.set(true);
    if (!this.buildingId || this.createForm.invalid || this.creating()) return;
    if (this.selectedInvoiceIds().size === 0) return;
    const raw = this.createForm.getRawValue();
    const dto: any = {
      unitId: raw.unitId,
      invoiceIds: [...this.selectedInvoiceIds()],
      ...(raw.title.trim() ? { title: raw.title.trim() } : {}),
      ...(raw.lawyerName.trim() ? { lawyerName: raw.lawyerName.trim() } : {}),
      ...(raw.lawyerEmail.trim() ? { lawyerEmail: raw.lawyerEmail.trim() } : {}),
      ...(raw.notes.trim() ? { notes: raw.notes.trim() } : {}),
    };
    this.creating.set(true);
    this.legalApi.createCase(this.buildingId, dto).subscribe({
      next: () => {
        this.toast.success('Η υπόθεση δημιουργήθηκε (NOTICE).');
        this.creating.set(false);
        this.closeCreateModal();
        this.reload();
      },
      error: (err: any) => {
        const msg = err?.error?.message || 'Η δημιουργία απέτυχε.';
        this.toast.error(msg);
        this.creating.set(false);
      },
    });
  }

  protected sendNotice(c: LegalCaseDto): void {
    if (!this.buildingId || this.sending()) return;
    this.sending.set(true);
    this.legalApi
      .sendNotice(this.buildingId, c.id)
      .subscribe({
        next: (res: any) => {
          this.toast.success('Το εξώδικο απεστάλη.');
          this.sending.set(false);
          // res may contain html+case or just case
          const updated: LegalCaseDto | undefined = res?.case ?? res;
          if (updated?.id) this.selected.set(updated as LegalCaseDto);
          this.reload();
          // if res contains html, show preview
          if (res?.html) this.exodikHtml.set(res.html);
        },
        error: (err: any) => {
          if (err?.status === 429) this.toast.error('Το εξώδικο έχει ήδη αποσταλεί τις τελευταίες 7 ημέρες (429).');
          else this.toast.error('Η αποστολή απέτυχε.');
          this.sending.set(false);
        },
      });
  }

  protected advanceStage(c: LegalCaseDto, nextStage: string): void {
    if (!this.buildingId || this.advancing()) return;
    this.advancing.set(true);
    this.legalApi.advanceStage(this.buildingId, c.id, nextStage).subscribe({
      next: (updated) => {
        this.toast.success(`Κλιμακώθηκε σε ${legalStageLabel(nextStage)}.`);
        this.selected.set(updated);
        this.advancing.set(false);
        this.reload();
      },
      error: (err: any) => {
        this.toast.error(err?.error?.message || 'Η κλιμάκωση απέτυχε.');
        this.advancing.set(false);
      },
    });
  }

  protected addNote(c: LegalCaseDto): void {
    if (!this.buildingId || this.noting() || this.noteForm.invalid) return;
    const note = this.noteForm.getRawValue().note.trim();
    if (!note) return;
    this.noting.set(true);
    this.legalApi.addNote(this.buildingId, c.id, note).subscribe({
      next: (updated) => {
        this.toast.success('Η σημείωση προστέθηκε.');
        this.selected.set(updated);
        this.noteForm.reset({ note: '' });
        this.noting.set(false);
      },
      error: () => {
        this.toast.error('Η προσθήκη σημείωσης απέτυχε.');
        this.noting.set(false);
      },
    });
  }

  protected closeLegalCase(c: LegalCaseDto): void {
    if (!this.buildingId || this.closing()) return;
    const reason = this.closeForm.getRawValue().reason.trim() || undefined;
    if (!confirm(`Κλείσιμο υπόθεσης "${c.title}"; Συνέχεια;`)) return;
    this.closing.set(true);
    this.legalApi.closeCase(this.buildingId, c.id, reason).subscribe({
      next: (updated) => {
        this.toast.success('Η υπόθεση έκλεισε.');
        this.selected.set(updated);
        this.closing.set(false);
        this.reload();
      },
      error: () => {
        this.toast.error('Το κλείσιμο απέτυχε.');
        this.closing.set(false);
      },
    });
  }

  protected reload(): void {
    this.reloadCases();
    this.reloadStats();
    this.reloadAux();
  }

  protected reloadCases(): void {
    if (!this.buildingId) return;
    this.loading.set(true);
    this.loadError.set(false);
    const stage = this.filterStage() || undefined;
    const status = this.filterStatus() || undefined;
    this.legalApi
      .listCases(this.buildingId, stage, status)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((cases) => {
        this.cases.set(cases);
        this.loading.set(false);
      });
  }

  private reloadStats(): void {
    if (!this.buildingId) return;
    this.legalApi
      .getStats(this.buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((stats) => this.stats.set(stats));
  }

  private reloadAux(): void {
    if (!this.buildingId) return;
    const buildingId = this.buildingId;
    forkJoin({
      units: this.unitsApi.list(buildingId),
      arrears: this.buildingsApi.arrears(buildingId),
      invoices: this.http.get<InvoiceLite[]>(`${environment.apiUrl}/buildings/${buildingId}/invoices`),
    })
      .pipe(catchError(() => EMPTY))
      .subscribe(({ units, arrears, invoices }) => {
        this.units.set(units);
        this.arrearsMap.set(new Map(arrears.rows.map((r) => [r.unitId, r.outstandingCents])));
        this.allInvoices.set(invoices);
      });
  }
}
