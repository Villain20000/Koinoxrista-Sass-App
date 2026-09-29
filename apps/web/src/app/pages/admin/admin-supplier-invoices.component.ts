import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import type {
  SupplierInvoiceDto,
  SupplierInvoiceStatsDto,
  SupplierInvoiceStatus,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { SupplierInvoicesApiService } from '../../core/api/supplier-invoices-api.service';
import { ExpensesApiService } from '../../core/api/expenses-api.service';
import { ToastService } from '../../ui/toast.service';
import { formatEuros } from '../../ui/format';

type StatusMeta = { label: string; badgeClass: string };
const STATUS_META: Record<SupplierInvoiceStatus, StatusMeta> = {
  DRAFT: { label: 'Πρόχειρο', badgeClass: 'bg-slate-200 text-slate-700' },
  IMPORTED: { label: 'Εισήχθη', badgeClass: 'bg-blue-100 text-blue-700' },
  MATCHED: { label: 'Αντιστοιχίστηκε', badgeClass: 'bg-emerald-100 text-emerald-700' },
  VOIDED: { label: 'Ακυρωμένο', badgeClass: 'bg-red-100 text-red-700' },
};

@Component({
  selector: 'app-admin-supplier-invoices',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-2 text-xl font-bold text-slate-900">Τιμολόγια προμηθευτών</h1>
    <p class="mb-6 text-sm text-slate-500">myDATA εισαγωγή (pull + OCR), χειροκίνητη καταχώρηση & αντιστοίχιση σε έξοδα.</p>

    <!-- Stats KPI -->
    @if (stats(); as s) {
      <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Σύνολο καθαρή αξία</p>
          <p class="mt-1 text-lg font-bold text-slate-900">{{ euros(s.totals.netCents) }}</p>
          <p class="text-xs text-slate-500">ΦΠΑ {{ euros(s.totals.vatCents) }} · Σύνολο {{ euros(s.totals.totalCents) }}</p>
        </div>
        <div class="card">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Πρόχειρα</p>
          <p class="mt-1 text-lg font-bold text-amber-600">{{ s.draftCount }}</p>
          <p class="text-xs text-slate-500">Εισήχθησαν {{ s.importedCount }} · Αντιστοιχίστηκαν {{ s.matchedCount }}</p>
        </div>
        <div class="card">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Μηνιαία εισροή</p>
          @if (s.monthly.length) {
            <ul class="mt-1 space-y-1">
              @for (m of s.monthly.slice(-3); track m.month) {
                <li class="flex justify-between text-xs"><span>{{ m.month }}</span><span class="font-medium">{{ euros(m.totalCents) }} ({{ m.count }})</span></li>
              }
            </ul>
          } @else {
            <p class="mt-1 text-sm text-slate-400">Καμία εισροή</p>
          }
        </div>
        <div class="card">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Σύνοψη ΦΠΑ (λογιστήριο)</p>
          <p class="mt-1 text-sm font-medium">{{ euros(s.vatSummary.totalVatCents) }} ΦΠΑ επί {{ euros(s.vatSummary.totalNetCents) }}</p>
          @if (s.vatSummary.byClassification) {
            <div class="mt-2 flex flex-wrap gap-1">
              @for (entry of vatEntries(s); track entry.key) {
                <span class="badge !px-1.5 !py-0 text-[10px] bg-slate-100 text-slate-700">{{ entry.key }}: {{ euros(entry.value.vatCents) }}</span>
              }
            </div>
          }
        </div>
      </div>
    } @else {
      <div class="card mb-6 text-sm text-slate-500">Φόρτωση στατιστικών…</div>
    }

    <!-- Actions + Filters -->
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="label" for="statusFilter">Κατάσταση</label>
        <select id="statusFilter" class="input" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event); reload()">
          <option value="">Όλα</option>
          <option value="DRAFT">Πρόχειρο</option>
          <option value="IMPORTED">Εισήχθη</option>
          <option value="MATCHED">Αντιστοιχίστηκε</option>
          <option value="VOIDED">Ακυρωμένο</option>
        </select>
      </div>
      <div>
        <label class="label" for="fromFilter">Από</label>
        <input id="fromFilter" type="date" class="input" [ngModel]="fromFilter()" (ngModelChange)="fromFilter.set($event)" />
      </div>
      <div>
        <label class="label" for="toFilter">Έως</label>
        <input id="toFilter" type="date" class="input" [ngModel]="toFilter()" (ngModelChange)="toFilter.set($event)" />
      </div>
      <button type="button" class="btn btn-secondary" (click)="reload()">Φίλτρα</button>
      <span class="flex-1"></span>
      <button type="button" class="btn btn-secondary" (click)="showManual.set(true)">+ Χειροκίνητο</button>
      <button type="button" class="btn btn-secondary" (click)="showJson.set(true)">+ JSON</button>
      <label class="btn btn-secondary cursor-pointer">
        <input type="file" class="hidden" accept="application/pdf" (change)="onPdfSelected($event)" />
        + PDF (OCR)
      </label>
      <button type="button" class="btn btn-primary" (click)="pullMyData()" [disabled]="pulling()">
        {{ pulling() ? 'Κλήση myDATA…' : 'Pull myDATA' }}
      </button>
    </div>

    @if (pullResult(); as r) {
      <div class="card mb-4 border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
        Εισήχθησαν {{ r.imported }} · παραλείφθηκαν {{ r.skipped }} (σύνολο {{ r.total }})
      </div>
    }

    @if (loadError()) {
      <div class="card mb-4 border-red-200 bg-red-50 text-sm text-red-700">Αποτυχία φόρτωσης τιμολογίων.</div>
    }

    <!-- Table -->
    <div class="card overflow-x-auto p-0">
      <table class="data-table">
        <thead>
          <tr>
            <th>Εκδότης</th>
            <th>ΑΦΜ</th>
            <th>Ημερομηνία</th>
            <th class="text-right">Καθαρό</th>
            <th class="text-right">ΦΠΑ</th>
            <th class="text-right">Σύνολο</th>
            <th>Κατάσταση</th>
            <th>Έξοδο</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (inv of invoices(); track inv.id) {
            <tr [class.bg-slate-50]="selectedId() === inv.id">
              <td>
                <span class="font-medium">{{ inv.issuerName }}</span>
                @if (inv.classification) {
                  <span class="block text-xs text-slate-500">{{ inv.classification }}</span>
                }
                @if (inv.mydataMark) {
                  <span class="block text-[10px] font-mono text-slate-400">{{ inv.mydataMark }}</span>
                }
              </td>
              <td class="font-mono text-xs">{{ inv.issuerAfm || '—' }}</td>
              <td class="whitespace-nowrap text-xs">{{ formatDate(inv.issueDate) }}</td>
              <td class="text-right text-xs">{{ euros(inv.netCents) }}</td>
              <td class="text-right text-xs">{{ euros(inv.vatCents) }}</td>
              <td class="text-right font-medium">{{ euros(inv.totalCents) }}</td>
              <td><span class="badge" [class]="statusBadge(inv.status).badgeClass">{{ statusBadge(inv.status).label }}</span></td>
              <td class="text-xs">
                @if (inv.expenseId) {
                  <span class="badge bg-emerald-100 text-emerald-700">{{ inv.expenseId.slice(0, 8) }}</span>
                } @else {
                  <span class="text-slate-400">—</span>
                }
              </td>
              <td class="whitespace-nowrap text-right">
                <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="select(inv)">👁</button>
                @if (inv.status !== 'VOIDED' && inv.status !== 'MATCHED') {
                  <button type="button" class="btn btn-primary ml-1 !px-2 !py-1 text-xs" (click)="openMatch(inv)">Αντιστοίχιση</button>
                  <button type="button" class="btn btn-secondary ml-1 !px-2 !py-1 text-xs text-red-600" (click)="voidInv(inv)">Ακύρωση</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="9" class="py-8 text-center text-sm text-slate-500">Δεν υπάρχουν τιμολόγια για τα επιλεγμένα φίλτρα.</td></tr>
          }
        </tbody>
      </table>
      <div class="flex items-center justify-between border-t border-slate-200 px-4 py-3">
        <span class="text-xs text-slate-500">Σύνολο {{ total() }} · σελίδα {{ page() }}</span>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" [disabled]="page() <= 1" (click)="prevPage()">‹ Προηγούμενη</button>
          <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" [disabled]="!hasNext()" (click)="nextPage()">Επόμενη ›</button>
        </div>
      </div>
    </div>

    <!-- Preview drawer -->
    @if (selected(); as inv) {
      <div class="card mt-6">
        <div class="flex items-center justify-between">
          <h2 class="card-title !mb-0">Προεπισκόπηση — {{ inv.issuerName }}</h2>
          <button type="button" class="btn btn-secondary !px-2 !py-1 text-xs" (click)="selectedId.set(null); selected.set(null)">Κλείσιμο</button>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          <div><span class="font-semibold">Εκδότης:</span> {{ inv.issuerName }} (ΑΦΜ {{ inv.issuerAfm || '—' }})</div>
          <div><span class="font-semibold">Ημερομηνία:</span> {{ formatDate(inv.issueDate) }}</div>
          <div><span class="font-semibold">Καθαρό:</span> {{ euros(inv.netCents) }} · ΦΠΑ {{ euros(inv.vatCents) }} · Σύνολο {{ euros(inv.totalCents) }}</div>
          <div><span class="font-semibold">Κατάσταση:</span> <span class="badge" [class]="statusBadge(inv.status).badgeClass">{{ statusBadge(inv.status).label }}</span></div>
          <div><span class="font-semibold">myDATA MARK:</span> {{ inv.mydataMark || '—' }}</div>
          <div><span class="font-semibold">Κατηγορία:</span> {{ inv.classification || '—' }}</div>
          @if (inv.pdfUrl) { <div><span class="font-semibold">PDF:</span> <span class="font-mono text-xs">{{ inv.pdfUrl }}</span></div> }
          @if (inv.expenseId) { <div><span class="font-semibold">Συνδεδεμένο έξοδο:</span> {{ inv.expenseId }}</div> }
        </div>
        @if (inv.rawJson) {
          <details class="mt-4">
            <summary class="cursor-pointer text-xs font-semibold text-slate-600">Raw JSON / OCR</summary>
            <pre class="mt-2 max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-emerald-100">{{ stringify(inv.rawJson) }}</pre>
          </details>
        }
      </div>
    }

    <!-- Manual modal -->
    @if (showManual()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" (click)="showManual.set(false)">
        <div class="card w-full max-w-lg" (click)="$event.stopPropagation()">
          <h2 class="card-title">Χειροκίνητο τιμολόγιο (DRAFT)</h2>
          <form [formGroup]="manualForm" (ngSubmit)="submitManual()" class="flex flex-col gap-4">
            <div>
              <label class="label" for="mIssuer">Εκδότης *</label>
              <input id="mIssuer" type="text" class="input" formControlName="issuerName" />
              @if (manualSubmitted() && manualForm.controls.issuerName.invalid) { <p class="field-error">Απαιτούνται ≥2 χαρακτήρες.</p> }
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label" for="mAfm">ΑΦΜ (9 ψηφία)</label>
                <input id="mAfm" type="text" class="input" formControlName="issuerAfm" maxlength="9" placeholder="094162110" />
                @if (manualSubmitted() && manualForm.controls.issuerAfm.invalid) { <p class="field-error">9 ψηφία.</p> }
              </div>
              <div>
                <label class="label" for="mDate">Ημερομηνία *</label>
                <input id="mDate" type="date" class="input" formControlName="issueDate" />
              </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="label" for="mNet">Καθαρό (€) *</label>
                <input id="mNet" type="number" step="0.01" min="0" class="input" formControlName="netEuros" />
              </div>
              <div>
                <label class="label" for="mVat">ΦΠΑ (€) *</label>
                <input id="mVat" type="number" step="0.01" min="0" class="input" formControlName="vatEuros" />
              </div>
              <div>
                <label class="label" for="mTotal">Σύνολο (€) *</label>
                <input id="mTotal" type="number" step="0.01" min="0.01" class="input" formControlName="totalEuros" />
              </div>
            </div>
            <div>
              <label class="label" for="mClass">Κατηγορία myDATA</label>
              <input id="mClass" type="text" class="input" formControlName="classification" placeholder="category1_1" />
            </div>
            <p class="text-xs text-slate-500">Το σύνολο πρέπει να ισούται με καθαρό + ΦΠΑ (έλεγχος στο backend).</p>
            <div class="flex gap-2">
              <button type="submit" class="btn btn-primary" [disabled]="savingManual()"> {{ savingManual() ? 'Καταχώρηση…' : 'Καταχώρηση' }} </button>
              <button type="button" class="btn btn-secondary" (click)="showManual.set(false)">Άκυρο</button>
            </div>
          </form>
        </div>
      </div>
    }

    <!-- JSON modal -->
    @if (showJson()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" (click)="showJson.set(false)">
        <div class="card w-full max-w-lg" (click)="$event.stopPropagation()">
          <h2 class="card-title">Εισαγωγή από myDATA JSON (IMPORTED)</h2>
          <p class="mb-3 text-xs text-slate-500">Επικολλήστε το JSON που λάβατε από myDATA (RequestDocs). Υποστηρίζονται διάφορες δομές με αυτόματη εξαγωγή πεδίων.</p>
          <textarea
            class="input min-h-40 font-mono text-xs"
            placeholder='{"issuerName":"ΔΕΗ Α.Ε.","issueDate":"2026-08-10","netCents":10000, ...} ή {"json":{...}}'
            [ngModel]="jsonText()"
            (ngModelChange)="jsonText.set($event)"
          ></textarea>
          @if (jsonError()) { <p class="field-error">{{ jsonError() }}</p> }
          <div class="mt-4 flex gap-2">
            <button type="button" class="btn btn-primary" (click)="submitJson()" [disabled]="savingJson()"> {{ savingJson() ? 'Εισαγωγή…' : 'Εισαγωγή JSON' }} </button>
            <button type="button" class="btn btn-secondary" (click)="showJson.set(false)">Άκυρο</button>
          </div>
        </div>
      </div>
    }

    <!-- Match modal -->
    @if (showMatch(); as inv) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" (click)="showMatch.set(null)">
        <div class="card w-full max-w-lg" (click)="$event.stopPropagation()">
          <h2 class="card-title">Αντιστοίχιση — {{ inv.issuerName }}</h2>
          <p class="mb-3 text-sm text-slate-600">{{ euros(inv.totalCents) }} · {{ formatDate(inv.issueDate) }} · {{ inv.classification || '—' }}</p>
          <div class="flex flex-col gap-3">
            <div>
              <label class="label" for="matchExpense">Επιλέξτε έξοδο (προαιρετικό)</label>
              <select id="matchExpense" class="input" [ngModel]="matchExpenseId()" (ngModelChange)="matchExpenseId.set($event)">
                <option value="">— Αυτόματη δημιουργία εξόδου (κατανομή με χιλιοστά) —</option>
                @for (exp of expenses(); track exp.id) {
                  <option [value]="exp.id">{{ exp.description }} — {{ euros(exp.totalCents) }} ({{ exp.periodYearMonth }})</option>
                }
              </select>
            </div>
            <p class="text-xs text-slate-500">Χωρίς επιλογή θα δημιουργηθεί νέο έξοδο στην κατηγορία “Προμήθειες” με ανάλυση χιλιοστών (largest-remainder). Το τιμολόγιο θα γίνει MATCHED και θα συνδεθεί με το έξοδο.</p>
            <div class="flex gap-2">
              <button type="button" class="btn btn-primary" (click)="submitMatch()" [disabled]="savingMatch()"> {{ savingMatch() ? 'Αντιστοίχιση…' : 'Αντιστοίχιση' }} </button>
              <button type="button" class="btn btn-secondary" (click)="showMatch.set(null)">Άκυρο</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminSupplierInvoicesPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly supplierApi = inject(SupplierInvoicesApiService);
  private readonly expensesApi = inject(ExpensesApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;

  protected readonly invoices = signal<SupplierInvoiceDto[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly take = 20;
  protected readonly stats = signal<SupplierInvoiceStatsDto | null>(null);
  protected readonly expenses = signal<Array<{ id: string; description: string; totalCents: number; periodYearMonth: string }>>([]);

  protected readonly statusFilter = signal<string>('');
  protected readonly fromFilter = signal<string>('');
  protected readonly toFilter = signal<string>('');

  protected readonly loadError = signal(false);
  protected readonly pulling = signal(false);
  protected readonly pullResult = signal<{ imported: number; skipped: number; total: number } | null>(null);

  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = signal<SupplierInvoiceDto | null>(null);

  protected readonly showManual = signal(false);
  protected readonly showJson = signal(false);
  protected readonly showMatch = signal<SupplierInvoiceDto | null>(null);
  protected readonly matchExpenseId = signal<string>('');

  protected readonly savingManual = signal(false);
  protected readonly manualSubmitted = signal(false);
  protected readonly savingJson = signal(false);
  protected readonly jsonText = signal('');
  protected readonly jsonError = signal<string | null>(null);
  protected readonly savingMatch = signal(false);

  protected readonly manualForm = this.fb.nonNullable.group({
    issuerName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(200)]],
    issuerAfm: ['', [Validators.pattern(/^\d{9}$/)]],
    issueDate: [new Date().toISOString().slice(0, 10), Validators.required],
    netEuros: this.fb.nonNullable.control<number | null>(null, [Validators.required, Validators.min(0)]),
    vatEuros: this.fb.nonNullable.control<number | null>(null, [Validators.required, Validators.min(0)]),
    totalEuros: this.fb.nonNullable.control<number | null>(null, [Validators.required, Validators.min(0.01)]),
    classification: [''],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
        this.reloadStats();
        this.expensesApi
          .list(building.id)
          .pipe(catchError(() => EMPTY))
          .subscribe((exps) => this.expenses.set(exps as any));
      });
  }

  protected hasNext(): boolean {
    return this.page() * this.take < this.total();
  }

  protected nextPage(): void {
    if (!this.hasNext()) return;
    this.page.update((p) => p + 1);
    this.reload();
  }

  protected prevPage(): void {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.reload();
  }

  protected reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    const params: Record<string, string | number> = {
      skip: (this.page() - 1) * this.take,
      take: this.take,
    };
    const status = this.statusFilter();
    if (status) params['status'] = status;
    const from = this.fromFilter();
    if (from) params['from'] = new Date(from).toISOString();
    const to = this.toFilter();
    if (to) params['to'] = new Date(to).toISOString();

    this.supplierApi
      .list(this.buildingId, params as any)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((res) => {
        // API may return { items, total } or array
        if (Array.isArray(res)) {
          this.invoices.set(res as any);
          this.total.set((res as any).length);
        } else {
          this.invoices.set((res as any).items ?? []);
          this.total.set((res as any).total ?? 0);
        }
      });
  }

  protected reloadStats(): void {
    if (!this.buildingId) return;
    this.supplierApi
      .stats(this.buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((s) => this.stats.set(s));
  }

  protected statusBadge(status: SupplierInvoiceStatus) {
    return STATUS_META[status] ?? { label: status, badgeClass: 'bg-slate-100 text-slate-700' };
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }

  protected stringify(obj: unknown): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  protected vatEntries(s: SupplierInvoiceStatsDto): Array<{ key: string; value: { netCents: number; vatCents: number; totalCents: number; count: number } }> {
    const map = (s.vatSummary as any)?.byClassification ?? {};
    return Object.entries(map).map(([key, value]) => ({ key, value: value as any }));
  }

  protected select(inv: SupplierInvoiceDto): void {
    this.selectedId.set(inv.id);
    // fetch full detail
    if (!this.buildingId) return;
    this.supplierApi
      .getById(this.buildingId, inv.id)
      .pipe(catchError(() => EMPTY))
      .subscribe((full) => this.selected.set(full));
  }

  protected openMatch(inv: SupplierInvoiceDto): void {
    this.matchExpenseId.set('');
    this.showMatch.set(inv);
  }

  protected submitMatch(): void {
    const inv = this.showMatch();
    if (!inv || !this.buildingId || this.savingMatch()) return;
    this.savingMatch.set(true);
    const expenseId = this.matchExpenseId() || undefined;
    this.supplierApi
      .match(this.buildingId, inv.id, expenseId)
      .subscribe({
        next: () => {
          this.toast.success(expenseId ? 'Συνδέθηκε με έξοδο.' : 'Δημιουργήθηκε έξοδο και αντιστοιχίστηκε.');
          this.savingMatch.set(false);
          this.showMatch.set(null);
          this.reload();
          this.reloadStats();
        },
        error: () => {
          this.toast.error('Η αντιστοίχιση απέτυχε.');
          this.savingMatch.set(false);
        },
      });
  }

  protected voidInv(inv: SupplierInvoiceDto): void {
    if (!this.buildingId) return;
    if (!confirm(`Ακύρωση τιμολογίου "${inv.issuerName}" — ${this.euros(inv.totalCents)};`)) return;
    this.supplierApi
      .void(this.buildingId, inv.id)
      .pipe(
        catchError(() => {
          this.toast.error('Η ακύρωση απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.info('Το τιμολόγιο ακυρώθηκε.');
        this.reload();
        this.reloadStats();
      });
  }

  protected pullMyData(): void {
    if (!this.buildingId || this.pulling()) return;
    this.pulling.set(true);
    this.pullResult.set(null);
    this.supplierApi
      .pullMyData(this.buildingId)
      .subscribe({
        next: (res) => {
          this.pulling.set(false);
          this.pullResult.set(res);
          if (res.imported > 0) this.toast.success(`Εισήχθησαν ${res.imported} τιμολόγια από myDATA.`);
          else this.toast.info(res.skipped > 0 ? `Καμία νέα εισαγωγή — ${res.skipped} ήδη υπάρχουν.` : 'Καμία εγγραφή από myDATA.');
          this.reload();
          this.reloadStats();
        },
        error: () => {
          this.pulling.set(false);
          this.toast.error('Το pull από myDATA απέτυχε.');
        },
      });
  }

  protected onPdfSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.buildingId) return;
    this.supplierApi
      .importPdf(this.buildingId, file)
      .subscribe({
        next: () => {
          this.toast.success('Το PDF αναλύθηκε με OCR και δημιουργήθηκε πρόχειρο.');
          this.reload();
          this.reloadStats();
          input.value = '';
        },
        error: () => {
          this.toast.error('Η ανάλυση PDF απέτυχε (OCR).');
          input.value = '';
        },
      });
  }

  protected submitManual(): void {
    this.manualSubmitted.set(true);
    if (!this.buildingId || this.manualForm.invalid || this.savingManual()) return;
    const raw = this.manualForm.getRawValue();
    const netCents = Math.round((raw.netEuros ?? 0) * 100);
    const vatCents = Math.round((raw.vatEuros ?? 0) * 100);
    const totalCents = Math.round((raw.totalEuros ?? 0) * 100);
    if (netCents + vatCents !== totalCents) {
      this.toast.error('Το σύνολο πρέπει να ισούται με καθαρό + ΦΠΑ.');
      return;
    }
    this.savingManual.set(true);
    this.supplierApi
      .createManual(this.buildingId, {
        issuerName: raw.issuerName.trim(),
        ...(raw.issuerAfm.trim() ? { issuerAfm: raw.issuerAfm.trim() } : {}),
        issueDate: raw.issueDate,
        netCents,
        vatCents,
        totalCents,
        currency: 'EUR',
        ...(raw.classification.trim() ? { classification: raw.classification.trim() } : {}),
      })
      .subscribe({
        next: () => {
          this.toast.success('Καταχωρήθηκε πρόχειρο τιμολόγιο.');
          this.savingManual.set(false);
          this.manualSubmitted.set(false);
          this.showManual.set(false);
          this.manualForm.reset({
            issuerName: '',
            issuerAfm: '',
            issueDate: new Date().toISOString().slice(0, 10),
            netEuros: null,
            vatEuros: null,
            totalEuros: null,
            classification: '',
          });
          this.reload();
          this.reloadStats();
        },
        error: () => {
          this.toast.error('Η καταχώρηση απέτυχε.');
          this.savingManual.set(false);
        },
      });
  }

  protected submitJson(): void {
    this.jsonError.set(null);
    const text = this.jsonText().trim();
    if (!this.buildingId || !text || this.savingJson()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.jsonError.set('Μη έγκυρο JSON.');
      return;
    }
    this.savingJson.set(true);
    this.supplierApi
      .importJson(this.buildingId, parsed)
      .subscribe({
        next: () => {
          this.toast.success('Εισήχθη από JSON.');
          this.savingJson.set(false);
          this.showJson.set(false);
          this.jsonText.set('');
          this.jsonError.set(null);
          this.reload();
          this.reloadStats();
        },
        error: (err) => {
          const msg = (err?.error as any)?.message ?? 'Η εισαγωγή JSON απέτυχε.';
          this.jsonError.set(Array.isArray(msg) ? msg.join(', ') : String(msg));
          this.savingJson.set(false);
        },
      });
  }
}
