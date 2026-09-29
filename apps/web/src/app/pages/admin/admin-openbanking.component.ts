import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import type {
  BankConnectionDto,
  ImportedTransactionSuggestionDto,
} from '@org/shared/lib/openbanking';
import { OpenBankingApiService } from '../../core/api/openbanking-api.service';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { ToastService } from '../../ui/toast.service';
import { formatEuros } from '../../ui/format';
import { confidenceCls, confidenceLabel } from './admin-bank-import.component';

@Component({
  selector: 'app-admin-openbanking',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">
      Τραπεζική σύνδεση (PSD2)
    </h1>

    @if (message(); as banner) {
      <div class="card mb-6 bg-emerald-50 text-sm text-emerald-700">
        {{ banner }}
      </div>
    }
    @if (error()) {
      <div class="card mb-6 border-red-200 bg-red-50 text-sm text-red-700">
        {{ error() }}
      </div>
    }

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card lg:col-span-1">
        <h2 class="card-title">Νέα σύνδεση λογαριασμού</h2>
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="iban">IBAN</label>
            <input
              id="iban"
              type="text"
              class="input font-mono text-xs uppercase"
              placeholder="GR16 0110 1250 0000 0001 2300 695"
              formControlName="iban"
            />
            @if (submitted() && form.controls.iban.invalid) {
              <p class="field-error">Δώστε έγκυρο IBAN.</p>
            }
          </div>
          <div>
            <label class="label" for="institution">Τράπεζα (προαιρετικό)</label>
            <input
              id="institution"
              type="text"
              class="input"
              placeholder="π.χ. Τράπεζα Πειραιώς"
              formControlName="institutionName"
            />
          </div>
          <button
            type="submit"
            class="btn btn-primary self-start"
            [disabled]="saving()"
          >
            Σύνδεση
          </button>
        </form>
      </div>

      <div class="card overflow-x-auto p-0 lg:col-span-2">
        <table class="data-table">
          <thead>
            <tr>
              <th>Τράπεζα</th>
              <th>IBAN</th>
              <th>Λειτουργία</th>
              <th>Τελευταίος συγχρονισμός</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (c of connections(); track c.id) {
              <tr>
                <td class="font-medium">{{ c.institutionName }}</td>
                <td class="font-mono text-xs">{{ c.iban }}</td>
                <td>
                  <span class="badge bg-slate-100 text-slate-600">{{
                    c.mode === 'gocardless' ? 'Live (PSD2)' : 'Δοκιμαστική'
                  }}</span>
                </td>
                <td>{{ when(c.lastSyncedAt) }}</td>
                <td class="whitespace-nowrap">
                  <button
                    type="button"
                    class="btn btn-secondary !px-2 !py-1 text-xs"
                    [disabled]="syncing() === c.id"
                    (click)="sync(c)"
                  >
                    Συγχρονισμός
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary ml-2 !px-2 !py-1 text-xs"
                    (click)="showTransactions(c)"
                  >
                    Κινήσεις
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary ml-2 !px-2 !py-1 text-xs text-red-600"
                    [disabled]="deleting() === c.id"
                    (click)="remove(c)"
                  >
                    Διαγραφή
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="py-8 text-center text-slate-500">
                  Δεν υπάρχει συνδεδεμένος λογαριασμός.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    @if (selected(); as sel) {
      <h2 class="mt-8 mb-3 font-semibold text-slate-900">
        Κινήσεις · {{ sel.institutionName }} ({{ sel.iban }})
      </h2>
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ημερομηνία</th>
              <th>Αιτιολογία</th>
              <th class="text-right">Ποσό</th>
              <th>Βεβαιότητα αντιστοίχισης</th>
            </tr>
          </thead>
          <tbody>
            @for (t of transactions(); track t.id) {
              <tr>
                <td class="whitespace-nowrap">{{ day(t.bookedAt) }}</td>
                <td class="max-w-64 truncate" [title]="t.remittanceInfo ?? ''">
                  {{ t.remittanceInfo || '—' }}
                </td>
                <td class="text-right font-medium whitespace-nowrap">
                  {{ euros(t.amountCents) }}
                </td>
                <td>
                  @if (t.suggestionConfidence; as confidence) {
                    <span class="badge" [class]="confidenceCls(confidence)">
                      {{ confidenceLabel(confidence) }}
                    </span>
                  } @else {
                    <span class="text-slate-300">—</span>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="py-8 text-center text-slate-500">
                  Πατήστε «Συγχρονισμός» για ανάκτηση κινήσεων από την τράπεζα.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AdminOpenBankingPage implements OnInit {
  private readonly openBankingApi = inject(OpenBankingApiService);
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;
  protected readonly confidenceLabel = confidenceLabel;
  protected readonly confidenceCls = confidenceCls;

  protected readonly connections = signal<BankConnectionDto[]>([]);
  protected readonly selected = signal<BankConnectionDto | null>(null);
  protected readonly transactions = signal<
    ImportedTransactionSuggestionDto[]
  >([]);
  protected readonly message = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly syncing = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    iban: ['', [Validators.required, Validators.pattern(/^[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,30}$/)]],
    institutionName: [''],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set('Αποτυχία φόρτωσης πολυκατοικίας.');
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    const { iban, institutionName } = this.form.getRawValue();
    this.saving.set(true);
    this.openBankingApi
      .create(this.buildingId, {
        iban,
        ...(institutionName.trim() ? { institutionName: institutionName.trim() } : {}),
      })
      .subscribe({
        next: () => {
          this.toast.success('Η σύνδεση δημιουργήθηκε.');
          this.saving.set(false);
          this.submitted.set(false);
          this.form.reset({ iban: '', institutionName: '' });
          this.reload();
        },
        error: () => {
          this.error.set('Η δημιουργία της σύνδεσης απέτυχε.');
          this.saving.set(false);
        },
      });
  }

  protected sync(connection: BankConnectionDto): void {
    if (this.syncing()) return;
    this.syncing.set(connection.id);
    this.error.set(null);
    this.message.set(null);
    this.openBankingApi
      .sync(connection.id)
      .pipe(
        catchError(() => {
          this.error.set('Ο συγχρονισμός απέτυχε. Δοκιμάστε ξανά.');
          this.syncing.set(null);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.syncing.set(null);
        this.message.set(
          `${result.newCount} νέες κινήσεις · Προτάσεις — Υψηλή: ${result.high}, Μεσαία: ${result.medium}, Χαμηλή: ${result.low}`,
        );
        this.reload();
        if (this.selected()?.id === connection.id) {
          this.loadTransactions(connection);
        }
      });
  }

  protected showTransactions(connection: BankConnectionDto): void {
    if (this.selected()?.id === connection.id) {
      this.selected.set(null);
      this.transactions.set([]);
      return;
    }
    this.selected.set(connection);
    this.loadTransactions(connection);
  }

  protected remove(connection: BankConnectionDto): void {
    if (this.deleting()) return;
    this.deleting.set(connection.id);
    this.openBankingApi
      .remove(connection.id)
      .subscribe({
        next: () => {
          this.toast.success('Η σύνδεση διαγράφηκε.');
          this.deleting.set(null);
          if (this.selected()?.id === connection.id) {
            this.selected.set(null);
            this.transactions.set([]);
          }
          this.reload();
        },
        error: () => {
          this.toast.error('Η διαγραφή απέτυχε.');
          this.deleting.set(null);
        },
      });
  }

  protected when(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString('el-GR') : 'Ποτέ';
  }

  protected day(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }

  private loadTransactions(connection: BankConnectionDto): void {
    this.openBankingApi
      .transactions(connection.id)
      .pipe(
        catchError(() => {
          this.error.set('Αποτυχία φόρτωσης κινήσεων.');
          return EMPTY;
        }),
      )
      .subscribe((txs) => this.transactions.set(txs));
  }

  private reload(): void {
    if (!this.buildingId) return;
    this.openBankingApi
      .list(this.buildingId)
      .pipe(
        catchError(() => {
          this.error.set('Αποτυχία φόρτωσης συνδέσεων.');
          return EMPTY;
        }),
      )
      .subscribe((connections) => this.connections.set(connections));
  }
}
