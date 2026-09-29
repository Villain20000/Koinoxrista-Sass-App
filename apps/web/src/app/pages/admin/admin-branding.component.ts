import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, catchError } from 'rxjs';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { BrandingApiService } from '../../core/api/branding-api.service';
import { ToastService } from '../../ui/toast.service';

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DOMAIN_PATTERN = /^(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
const URL_PATTERN = /^https:\/\//;

/**
 * ADMIN white-label branding (Premium tier): logo, colors, organization
 * display name, print footer and the reserved custom domain.
 * Route: /admin/branding
 */
@Component({
  selector: 'app-admin-branding',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Επωνυμία &amp; Χρώματα</h1>

    @if (loadError()) {
      <div class="card mb-4 border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης ρυθμίσεων επωνυμίας.
      </div>
    }

    <div class="grid gap-6 lg:grid-cols-2">
      <form [formGroup]="form" (ngSubmit)="save()" class="card flex flex-col gap-4">
        <div>
          <label class="label" for="orgName">Επωνυμία διαχειριστή (προαιρετική)</label>
          <input
            id="orgName"
            type="text"
            class="input"
            formControlName="orgName"
            placeholder="π.χ. Διαχειριστική Κασσάνδρας"
          />
          <p class="mt-1 text-xs text-slate-500">
            Εμφανίζεται στις εκτυπώσεις πάνω από το όνομα της πολυκατοικίας.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label class="label" for="primaryColor">Κύριο χρώμα</label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="h-9 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                [value]="safeHex(primaryColor.value)"
                (input)="setColor('primaryColor', $event)"
                aria-label="Επιλογή κύριου χρώματος"
              />
              <input
                id="primaryColor"
                type="text"
                class="input !w-32 font-mono"
                formControlName="primaryColor"
                spellcheck="false"
              />
              <span
                class="inline-block h-8 w-8 shrink-0 rounded-full border border-slate-200"
                [style.background-color]="swatch(primaryColor.value, '#1e40af')"
                aria-hidden="true"
              ></span>
            </div>
            @if (submitted() && form.controls.primaryColor.invalid) {
              <p class="field-error">Έγκυρο hex, π.χ. #1e40af ή #0af.</p>
            }
          </div>
          <div>
            <label class="label" for="accentColor">Δευτερεύον χρώμα</label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="h-9 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                [value]="safeHex(accentColor.value)"
                (input)="setColor('accentColor', $event)"
                aria-label="Επιλογή δευτερεύοντος χρώματος"
              />
              <input
                id="accentColor"
                type="text"
                class="input !w-32 font-mono"
                formControlName="accentColor"
                spellcheck="false"
              />
              <span
                class="inline-block h-8 w-8 shrink-0 rounded-full border border-slate-200"
                [style.background-color]="swatch(accentColor.value, '#0ea5e9')"
                aria-hidden="true"
              ></span>
            </div>
            @if (submitted() && form.controls.accentColor.invalid) {
              <p class="field-error">Έγκυρο hex, π.χ. #0ea5e9 ή #0af.</p>
            }
          </div>
        </div>

        <div>
          <label class="label" for="logoUrl">Logo URL (https)</label>
          <input
            id="logoUrl"
            type="url"
            class="input"
            formControlName="logoUrl"
            placeholder="https://cdn.example.gr/logo.png"
            (input)="logoBroken.set(false)"
          />
          @if (submitted() && form.controls.logoUrl.invalid) {
            <p class="field-error">Το logo πρέπει να είναι έγκυρη διεύθυνση https://.</p>
          }
          @if (logoPreview(); as preview) {
            <img
              [src]="preview"
              alt="Προεπισκόπηση λογοτύπου"
              class="mt-2 max-h-16 rounded border border-slate-200 bg-white object-contain p-1"
              (error)="logoBroken.set(true)"
            />
          }
        </div>

        <div>
          <label class="label" for="footerText">Κείμενο υποσέλιδου εκτύπωσης (προαιρετικό)</label>
          <textarea id="footerText" rows="2" class="input" formControlName="footerText"></textarea>
        </div>

        <div>
          <label class="label" for="customDomain">Custom domain (για μελλοντική χρήση)</label>
          <input
            id="customDomain"
            type="text"
            class="input font-mono"
            formControlName="customDomain"
            placeholder="brand.example.gr"
            spellcheck="false"
          />
          @if (submitted() && form.controls.customDomain.invalid) {
            <p class="field-error">Μορφή: brand.example.gr — χωρίς protocol και path.</p>
          }
        </div>

        <div class="flex items-center gap-3">
          <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
            Αποθήκευση
          </button>
          @if (savedAt(); as at) {
            <span class="text-xs text-slate-500">Αποθηκεύτηκε {{ at }}</span>
          }
        </div>
      </form>

      <aside class="card self-start">
        <h2 class="card-title">Προεπισκόπηση εκτύπωσης</h2>
        <div
          class="overflow-hidden rounded-lg border border-slate-200 bg-white"
          [style.border-top]="'6px solid ' + swatch(primaryColor.value, '#1e40af')"
        >
          <div class="p-4">
            @if (logoPreview()) {
              <img
                [src]="logoPreview()"
                alt=""
                class="mb-2 max-h-12 object-contain"
                (error)="logoBroken.set(true)"
              />
            }
            <p class="text-sm font-bold text-slate-900">
              {{ orgName.value?.trim() || buildingName() || 'Οικοδομική Διαχείριση' }}
            </p>
            @if (buildingName()) {
              <p class="text-xs text-slate-500">{{ buildingName() }}</p>
            }
            <div
              class="mt-3 rounded px-3 py-2 text-center text-xs font-semibold text-white"
              [style.background-color]="swatch(accentColor.value, '#0ea5e9')"
            >
              Ετήσιο αποδεικτικό κοινοχρήστων
            </div>
            @if (footerText.value?.trim()) {
              <p class="mt-2 text-center text-[10px] text-slate-400">
                {{ footerText.value }}
              </p>
            }
          </div>
        </div>
      </aside>
    </div>
  `,
})
export class AdminBrandingPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly brandingApi = inject(BrandingApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly loadError = signal(false);
  protected readonly savedAt = signal<string | null>(null);
  protected readonly logoBroken = signal(false);
  protected readonly buildingName = signal('');

  protected readonly form = this.fb.nonNullable.group({
    orgName: ['', [Validators.maxLength(120)]],
    primaryColor: ['#1e40af', [Validators.required, Validators.pattern(HEX_PATTERN)]],
    accentColor: ['#0ea5e9', [Validators.required, Validators.pattern(HEX_PATTERN)]],
    logoUrl: ['', [Validators.pattern(URL_PATTERN)]],
    footerText: ['', [Validators.maxLength(240)]],
    customDomain: ['', [Validators.pattern(DOMAIN_PATTERN)]],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.buildingName.set(building.name);
        this.reload();
      });
  }

  protected get primaryColor() {
    return this.form.controls.primaryColor;
  }

  protected get accentColor() {
    return this.form.controls.accentColor;
  }

  protected get orgName() {
    return this.form.controls.orgName;
  }

  protected get footerText() {
    return this.form.controls.footerText;
  }

  /** Live logo preview; hidden once the URL fails to load or is cleared. */
  protected logoPreview(): string | null {
    const url = this.form.controls.logoUrl.value.trim();
    return url && !this.logoBroken() ? url : null;
  }

  protected setColor(control: 'primaryColor' | 'accentColor', event: Event): void {
    this.logoBroken.set(false);
    this.form.controls[control].setValue((event.target as HTMLInputElement).value);
  }

  protected safeHex(value: string): string {
    return HEX_PATTERN.test(value) ? value : '#000000';
  }

  protected swatch(value: string, fallback: string): string {
    return HEX_PATTERN.test(value) ? value : fallback;
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) {
      return;
    }
    const value = this.form.getRawValue();
    const optional = (raw: string): string | null => {
      const trimmed = raw.trim();
      return trimmed === '' ? null : trimmed;
    };

    this.saving.set(true);
    this.brandingApi
      .update(this.buildingId, {
        orgName: optional(value.orgName),
        primaryColor: value.primaryColor,
        accentColor: value.accentColor,
        logoUrl: optional(value.logoUrl),
        footerText: optional(value.footerText),
        customDomain: optional(value.customDomain),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.submitted.set(false);
          this.savedAt.set(
            new Date().toLocaleTimeString('el-GR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          );
          this.toast.success('Η επωνυμία & τα χρώματα αποθηκεύτηκαν.');
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.toast.error(
            err.status === 409
              ? 'Το custom domain χρησιμοποιείται ήδη από άλλη πολυκατοικία.'
              : 'Η αποθήκευση απέτυχε. Ελέγξτε τη μορφή των πεδίων.',
          );
        },
      });
  }

  protected reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    this.brandingApi
      .get(this.buildingId)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((branding) => {
        this.form.patchValue({
          orgName: branding.orgName ?? '',
          primaryColor: branding.primaryColor,
          accentColor: branding.accentColor,
          logoUrl: branding.logoUrl ?? '',
          footerText: branding.footerText ?? '',
          customDomain: branding.customDomain ?? '',
        });
        this.logoBroken.set(false);
      });
  }
}
