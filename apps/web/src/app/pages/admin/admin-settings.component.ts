import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MARKET_CODES, MARKET_REGISTRY } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';

@Component({
  selector: 'app-admin-settings',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Κτίριο — Ρυθμίσεις</h1>

    @if (loading()) {
      <p class="text-sm text-slate-500">Φόρτωση…</p>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">{{ error() }}</div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="save()" class="card max-w-xl flex flex-col gap-4">
        <div>
          <label class="label" for="market">Αγορά / Market</label>
          <select id="market" class="input" formControlName="market">
            @for (code of markets; track code) {
              <option [value]="code">{{ code }} — {{ registry[code].currency }} · {{ registry[code].pspProvider }}</option>
            }
          </select>
          <p class="text-xs text-slate-500 mt-1">Επιλέγει νόμισμα και PSP από προεπιλογή (παρακάμπτεται από τα παρακάτω).</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label" for="currency">Νόμισμα (ISO-4217)</label>
            <select id="currency" class="input" formControlName="currency">
              @for (c of currencies; track c) { <option [value]="c">{{ c }}</option> }
            </select>
          </div>
          <div>
            <label class="label" for="psp">PSP</label>
            <select id="psp" class="input" formControlName="pspProvider">
              @for (p of psps; track p) { <option [value]="p">{{ p }}</option> }
            </select>
          </div>
        </div>

        <div>
          <label class="label" for="inv">Αριθμός 適格請求書 (T+13)</label>
          <input id="inv" class="input" formControlName="invoiceRegistrationNo" placeholder="T1234567890123" />
          @if (form.controls.invoiceRegistrationNo.invalid && form.controls.invoiceRegistrationNo.touched) {
            <p class="field-error">Πρέπει να είναι T + 13 ψηφία ή κενό.</p>
          }
        </div>

        @if (message()) {
          <p class="text-sm" [class.text-emerald-700]="success()" [class.text-red-700]="!success()">{{ message() }}</p>
        }

        <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">{{ saving() ? 'Αποθήκευση…' : 'Αποθήκευση' }}</button>
      </form>
    }
  `,
})
export class AdminSettingsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly markets = [...MARKET_CODES];
  protected readonly registry = MARKET_REGISTRY;
  protected readonly currencies = ['EUR', 'USD', 'CAD', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'GBP', 'PLN', 'SEK', 'CZK'];
  protected readonly psps = ['viva', 'stripe', 'stripejp', 'mercadopago', 'gmo'] as const;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly success = signal(false);
  private buildingId: string | null = null;

  protected readonly form = this.fb.nonNullable.group({
    market: ['GR' as string],
    currency: ['EUR' as string],
    pspProvider: ['viva' as string],
    invoiceRegistrationNo: ['', [Validators.pattern(/^T[0-9]{13}$/)]],
  });

  ngOnInit(): void {
    this.buildingsApi.mine().subscribe({
      next: (building) => {
        this.buildingId = building.id;
        this.form.patchValue({
          market: (building as unknown as { market?: string }).market ?? 'GR',
          currency: (building as unknown as { currency?: string }).currency ?? 'EUR',
          pspProvider: (building as unknown as { pspProvider?: string }).pspProvider ?? 'viva',
          invoiceRegistrationNo: (building as unknown as { invoiceRegistrationNo?: string }).invoiceRegistrationNo ?? '',
        });
        // Keep currency in sync when market changes (unless user overrides)
        this.form.controls.market.valueChanges.subscribe((market) => {
          const profile = this.registry[market as keyof typeof this.registry];
          if (profile) {
            this.form.controls.currency.setValue(profile.currency as string);
            this.form.controls.pspProvider.setValue(profile.pspProvider as string);
          }
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Αποτυχία φόρτωσης κτιρίου');
        this.loading.set(false);
      },
    });
  }

  protected save(): void {
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.message.set(null);
    const raw = this.form.getRawValue();
    const dto: Record<string, string> = {
      market: raw.market,
      currency: raw.currency,
      pspProvider: raw.pspProvider,
    };
    // Only send invoiceRegistrationNo when touched or non-empty (empty = clear)
    dto['invoiceRegistrationNo'] = raw.invoiceRegistrationNo?.trim() ?? '';
    this.buildingsApi.updateSettings(this.buildingId, dto).subscribe({
      next: () => {
        this.success.set(true);
        this.message.set('Αποθηκεύτηκε.');
        this.saving.set(false);
      },
      error: (err) => {
        this.success.set(false);
        this.message.set(err?.error?.message ?? 'Αποτυχία αποθήκευσης');
        this.saving.set(false);
      },
    });
  }
}
