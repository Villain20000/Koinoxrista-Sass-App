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
  TreasuryAccountDto,
  TreasuryBalanceDto,
  TreasuryEntryDto,
} from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  TreasuryApiService,
  treasuryDirectionLabel,
  treasuryMethodLabel,
  treasuryAccountTypeLabel,
} from '../../core/api/treasury-api.service';
import { ToastService } from '../../ui/toast.service';
import { eurosToCents, formatEuros } from '../../ui/format';

@Component({
  selector: 'app-admin-treasury',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Ταμείο</h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης ταμείου. Δοκιμάστε ξανά.
      </div>
    } @else {
      <!-- KPI cards -->
      <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="card">
          <p class="text-sm text-slate-500">Συνολικό υπόλοιπο</p>
          <p class="stat-value mt-1">{{ euros(balance().totalCents) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Μετρητά (Ταμείο)</p>
          <p class="stat-value mt-1">{{ euros(balance().cashCents) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Τράπεζες</p>
          <p class="stat-value mt-1">{{ euros(balance().bankCents) }}</p>
        </div>
        <div class="card">
          <p class="text-sm text-slate-500">Μηνιαία κίνηση</p>
          <p class="text-sm mt-1">
            <span class="font-semibold text-emerald-600">IN {{ euros(monthlyInOut().inCents) }}</span>
            <span class="mx-1 text-slate-400">/</span>
            <span class="font-semibold text-red-600">OUT {{ euros(monthlyInOut().outCents) }}</span>
          </p>
        </div>
      </div>

      <!-- by-account breakdown -->
      @if (balance().byAccount.length > 0) {
        <div class="mb-6 flex flex-wrap gap-3">
          @for (row of balance().byAccount; track row.accountId) {
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
              <p class="font-medium text-slate-900">{{ row.name }}</p>
              <p class="text-xs text-slate-500">{{ typeLabel(row.type) }}</p>
              <p class="mt-1 font-semibold text-slate-900">{{ euros(row.balanceCents) }}</p>
            </div>
          }
        </div>
      }

      <!-- monthly chart -->
      <section class="card mb-6" aria-label="Μηνιαία κίνηση">
        <h2 class="card-title mb-3">Μηνιαία κίνηση (IN / OUT)</h2>
        @if (balance().byMonth.length === 0) {
          <p class="text-sm text-slate-500">Καμία κίνηση ακόμη.</p>
        } @else {
          <div class="flex flex-col gap-2">
            @for (bar of monthBars(); track bar.month) {
              <div class="flex items-center gap-3 text-sm">
                <span class="w-20 shrink-0 text-slate-500">{{ bar.month }}</span>
                <div class="flex h-4 grow gap-1">
                  <div class="h-4 rounded bg-emerald-500" [style.width.%]="bar.inPct"></div>
                  <div class="h-4 rounded bg-red-400" [style.width.%]="bar.outPct"></div>
                </div>
                <span class="w-36 shrink-0 text-right text-xs">
                  <span class="text-emerald-600">{{ euros(bar.inCents) }}</span>
                  <span class="text-slate-400"> / </span>
                  <span class="text-red-600">{{ euros(bar.outCents) }}</span>
                </span>
              </div>
            }
          </div>
        }
      </section>

      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Accounts -->
        <div class="card lg:col-span-1">
          <h2 class="card-title">Λογαριασμοί</h2>
          <form [formGroup]="accountForm" (ngSubmit)="createAccount()" class="mb-4 flex flex-col gap-3">
            <div>
              <label class="label" for="accName">Όνομα</label>
              <input
                id="accName"
                type="text"
                class="input"
                formControlName="name"
                placeholder="π.χ. Ταμείο, Τράπεζα Alpha"
              />
              @if (accountSubmitted() && accountForm.controls.name.invalid) {
                <p class="field-error">Το όνομα χρειάζεται ≥2 χαρακτήρες.</p>
              }
            </div>
            <div>
              <label class="label" for="accType">Τύπος</label>
              <select id="accType" class="input" formControlName="type">
                <option value="CASH">Μετρητά</option>
                <option value="BANK">Τράπεζα</option>
              </select>
            </div>
            @if (accountForm.controls.type.value === 'BANK') {
              <div>
                <label class="label" for="accIban">IBAN (προαιρετικό)</label>
                <input id="accIban" type="text" class="input" formControlName="iban" placeholder="GRxx..." />
              </div>
            }
            <button type="submit" class="btn btn-primary self-start" [disabled]="savingAccount()">
              Δημιουργία
            </button>
          </form>

          <div class="divide-y divide-slate-100 rounded border border-slate-200">
            @for (acc of accounts(); track acc.id) {
              <div class="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  <span class="font-medium">{{ acc.name }}</span>
                  <span class="ml-2 text-xs text-slate-500">{{ typeLabel(acc.type) }}</span>
                  @if (acc.iban) {
                    <span class="block text-xs text-slate-400">{{ acc.iban }}</span>
                  }
                </span>
                <span class="font-semibold">{{ euros(acc.balanceCents) }}</span>
              </div>
            } @empty {
              <p class="p-3 text-sm text-slate-500">Κανένας λογαριασμός ακόμη.</p>
            }
          </div>
        </div>

        <!-- Entries -->
        <div class="lg:col-span-2">
          <!-- Filters -->
          <div class="card mb-4">
            <h3 class="card-title mb-3">Φίλτρα κινήσεων</h3>
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="label" for="filterAccount">Λογαριασμός</label>
                <select id="filterAccount" class="input" [formControl]="filterAccount">
                  <option value="">Όλοι</option>
                  @for (acc of accounts(); track acc.id) {
                    <option [value]="acc.id">{{ acc.name }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="label" for="filterFrom">Από</label>
                <input id="filterFrom" type="date" class="input" [formControl]="filterFrom" />
              </div>
              <div>
                <label class="label" for="filterTo">Έως</label>
                <input id="filterTo" type="date" class="input" [formControl]="filterTo" />
              </div>
              <button type="button" class="btn btn-secondary self-end" (click)="reloadEntries()">Εφαρμογή</button>
            </div>
          </div>

          <!-- Entry creation -->
          <div class="card mb-4">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="card-title mb-0">Νέα κίνηση</h3>
              <button type="button" class="btn btn-secondary !px-3 !py-1 text-sm" (click)="entryModalOpen.set(!entryModalOpen())">
                {{ entryModalOpen() ? 'Απόκρυψη' : 'Καταχώρηση κίνησης' }}
              </button>
            </div>
            @if (entryModalOpen()) {
              <form [formGroup]="entryForm" (ngSubmit)="createEntry()" class="flex flex-col gap-3">
                <div>
                  <label class="label" for="entryAccount">Λογαριασμός *</label>
                  <select id="entryAccount" class="input" formControlName="accountId">
                    <option value="">— Επιλέξτε —</option>
                    @for (acc of accounts(); track acc.id) {
                      <option [value]="acc.id">{{ acc.name }} ({{ euros(acc.balanceCents) }})</option>
                    }
                  </select>
                  @if (entrySubmitted() && entryForm.controls.accountId.invalid) {
                    <p class="field-error">Επιλέξτε λογαριασμό.</p>
                  }
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="label" for="entryAmount">Ποσό (€) *</label>
                    <input id="entryAmount" type="number" min="0.01" step="0.01" class="input" formControlName="amount" />
                    @if (entrySubmitted() && entryForm.controls.amount.invalid) {
                      <p class="field-error">Δώστε έγκυρο ποσό.</p>
                    }
                  </div>
                  <div>
                    <label class="label" for="entryDirection">Κατεύθυνση *</label>
                    <select id="entryDirection" class="input" formControlName="direction">
                      <option value="IN">Εισροή (+)</option>
                      <option value="OUT">Εκροή (−)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label class="label" for="entryMethod">Μέθοδος *</label>
                  <select id="entryMethod" class="input" formControlName="method">
                    <option value="CASH">Μετρητά</option>
                    <option value="BANK">Τράπεζα</option>
                    <option value="CHECK">Επιταγή</option>
                    <option value="CARD">Κάρτα</option>
                  </select>
                </div>
                <div>
                  <label class="label" for="entryReference">Παραστατικό (προαιρετικό)</label>
                  <input id="entryReference" type="text" class="input" formControlName="reference" placeholder="π.χ. Απόδειξη #12" />
                </div>
                <div>
                  <label class="label" for="entryNotes">Σημειώσεις (προαιρετικό)</label>
                  <textarea id="entryNotes" rows="2" class="input" formControlName="notes"></textarea>
                </div>
                <button type="submit" class="btn btn-primary self-start" [disabled]="savingEntry()">Καταχώρηση</button>
              </form>
            }
          </div>

          <!-- Entries table -->
          <div class="card overflow-x-auto p-0">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Ημερομηνία</th>
                  <th>Λογαριασμός</th>
                  <th>Κατεύθυνση</th>
                  <th>Μέθοδος</th>
                  <th>Παραστατικό</th>
                  <th>Ποσό</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of entries(); track entry.id) {
                  <tr>
                    <td>{{ formatDate(entry.createdAt) }}</td>
                    <td class="font-medium">{{ entry.accountName || entry.accountId }}</td>
                    <td>
                      <span
                        class="badge"
                        [class]="entry.direction === 'IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'"
                      >
                        {{ directionLabel(entry.direction) }}
                      </span>
                    </td>
                    <td>{{ methodLabel(entry.method) }}</td>
                    <td class="text-slate-500">{{ entry.reference || '—' }}</td>
                    <td class="font-medium" [class]="entry.amountCents >= 0 ? 'text-emerald-600' : 'text-red-600'">
                      {{ euros(entry.amountCents) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="py-8 text-center text-slate-500">Δεν υπάρχουν κινήσεις για τα επιλεγμένα φίλτρα.</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (entriesTotal() > entries().length) {
              <div class="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
                <span class="text-slate-500">Εμφάνιση {{ entries().length }} από {{ entriesTotal() }}</span>
                <button type="button" class="btn btn-secondary !px-3 !py-1" (click)="loadMore()" [disabled]="loadingMore()">
                  Φόρτωση περισσότερων
                </button>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminTreasuryPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly treasuryApi = inject(TreasuryApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;
  protected readonly directionLabel = treasuryDirectionLabel;
  protected readonly methodLabel = treasuryMethodLabel;
  protected readonly typeLabel = treasuryAccountTypeLabel;

  protected readonly accounts = signal<TreasuryAccountDto[]>([]);
  protected readonly entries = signal<TreasuryEntryDto[]>([]);
  protected readonly entriesTotal = signal(0);
  protected readonly balance = signal<TreasuryBalanceDto>({
    totalCents: 0,
    cashCents: 0,
    bankCents: 0,
    byAccount: [],
    byMonth: [],
  });
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly savingAccount = signal(false);
  protected readonly savingEntry = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly accountSubmitted = signal(false);
  protected readonly entrySubmitted = signal(false);
  protected readonly entryModalOpen = signal(false);

  protected readonly filterAccount = this.fb.nonNullable.control('');
  protected readonly filterFrom = this.fb.nonNullable.control('');
  protected readonly filterTo = this.fb.nonNullable.control('');

  protected readonly accountForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: this.fb.nonNullable.control<'CASH' | 'BANK'>('CASH'),
    iban: [''],
  });

  protected readonly entryForm = this.fb.nonNullable.group({
    accountId: ['', Validators.required],
    amount: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    direction: this.fb.nonNullable.control<'IN' | 'OUT'>('IN'),
    method: this.fb.nonNullable.control<'CASH' | 'BANK' | 'CHECK' | 'CARD'>('CASH'),
    reference: [''],
    notes: [''],
  });

  private buildingId: string | null = null;
  private entriesSkip = 0;
  private readonly entriesTake = 25;

  protected readonly monthlyInOut = computed(() => {
    const months = this.balance().byMonth;
    if (months.length === 0) return { inCents: 0, outCents: 0 };
    // For KPI show current month or total of last month bucket
    const currMonth = new Date().toISOString().slice(0, 7);
    const found = months.find((m) => m.month === currMonth);
    if (found) return { inCents: found.inCents, outCents: found.outCents };
    // fallback: sum all months? Show last month's figures
    const last = months[months.length - 1];
    return { inCents: last.inCents, outCents: last.outCents };
  });

  protected readonly monthBars = computed(() => {
    const months = this.balance().byMonth;
    const max = Math.max(0, ...months.map((m) => Math.max(m.inCents, m.outCents)));
    return months.map((m) => ({
      ...m,
      inPct: max > 0 ? Math.max((m.inCents / max) * 50, m.inCents > 0 ? 2 : 0) : 0,
      outPct: max > 0 ? Math.max((m.outCents / max) * 50, m.outCents > 0 ? 2 : 0) : 0,
    }));
  });

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reloadAll();
      });
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }

  protected createAccount(): void {
    this.accountSubmitted.set(true);
    if (!this.buildingId || this.accountForm.invalid || this.savingAccount()) return;
    const { name, type, iban } = this.accountForm.getRawValue();
    this.savingAccount.set(true);
    this.treasuryApi
      .createAccount(this.buildingId, {
        name: name.trim(),
        type,
        ...(iban.trim() ? { iban: iban.trim() } : {}),
      })
      .subscribe({
        next: () => {
          this.toast.success('Ο λογαριασμός δημιουργήθηκε.');
          this.savingAccount.set(false);
          this.accountSubmitted.set(false);
          this.accountForm.reset({ name: '', type: 'CASH', iban: '' });
          this.reloadAll();
        },
        error: (err) => {
          this.savingAccount.set(false);
          if (err?.status === 409) {
            this.toast.error('Υπάρχει ήδη λογαριασμός με αυτό το όνομα.');
          } else {
            this.toast.error('Η δημιουργία λογαριασμού απέτυχε.');
          }
        },
      });
  }

  protected createEntry(): void {
    this.entrySubmitted.set(true);
    if (!this.buildingId || this.entryForm.invalid || this.savingEntry()) return;
    const { accountId, amount, direction, method, reference, notes } = this.entryForm.getRawValue();
    const centsAbs = eurosToCents(amount ?? NaN);
    if (!Number.isFinite(centsAbs) || centsAbs <= 0) return;
    const amountCents = direction === 'IN' ? centsAbs : -centsAbs;
    this.savingEntry.set(true);
    this.treasuryApi
      .createEntry(this.buildingId, {
        accountId,
        amountCents,
        direction,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      .subscribe({
        next: () => {
          this.toast.success('Η κίνηση καταχωρήθηκε.');
          this.savingEntry.set(false);
          this.entrySubmitted.set(false);
          this.entryForm.reset({
            accountId: '',
            amount: null,
            direction: 'IN',
            method: 'CASH',
            reference: '',
            notes: '',
          });
          this.entryModalOpen.set(false);
          this.reloadAll();
        },
        error: (err) => {
          this.savingEntry.set(false);
          const msg = err?.error?.message || 'Η καταχώρηση απέτυχε.';
          this.toast.error(Array.isArray(msg) ? msg.join(', ') : String(msg));
        },
      });
  }

  protected reloadEntries(): void {
    this.entriesSkip = 0;
    this.fetchEntries(false);
  }

  protected loadMore(): void {
    this.entriesSkip += this.entriesTake;
    this.fetchEntries(true);
  }

  private reloadAll(): void {
    if (!this.buildingId) return;
    this.loading.set(true);
    this.loadError.set(false);
    this.entriesSkip = 0;

    forkJoin({
      accounts: this.treasuryApi.listAccounts(this.buildingId),
      balance: this.treasuryApi.getBalance(this.buildingId),
      entries: this.treasuryApi.listEntries(this.buildingId, {
        accountId: this.filterAccount.value || undefined,
        from: this.filterFrom.value || undefined,
        to: this.filterTo.value || undefined,
        skip: 0,
        take: this.entriesTake,
      }),
    })
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ accounts, balance, entries }) => {
        this.accounts.set(accounts);
        this.balance.set(balance);
        this.entries.set(entries.items);
        this.entriesTotal.set(entries.total);
        this.loading.set(false);
      });
  }

  private fetchEntries(append: boolean): void {
    if (!this.buildingId) return;
    if (append) this.loadingMore.set(true);
    this.treasuryApi
      .listEntries(this.buildingId!, {
        accountId: this.filterAccount.value || undefined,
        from: this.filterFrom.value || undefined,
        to: this.filterTo.value || undefined,
        skip: this.entriesSkip,
        take: this.entriesTake,
      })
      .pipe(catchError(() => EMPTY))
      .subscribe((res) => {
        if (append) {
          this.entries.update((prev) => [...prev, ...res.items]);
          this.loadingMore.set(false);
        } else {
          this.entries.set(res.items);
        }
        this.entriesTotal.set(res.total);
        // refresh balance after filter changes? Keep full balance
        if (!append) {
          this.treasuryApi
            .getBalance(this.buildingId!)
            .pipe(catchError(() => EMPTY))
            .subscribe((balance) => this.balance.set(balance));
        }
      });
  }
}
