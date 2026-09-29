import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError } from 'rxjs';
import type { ComplianceItemDto, ComplianceKind } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { ComplianceApiService } from '../../core/api/compliance-api.service';
import { eurosToCents, formatEuros } from '../../ui/format';
import { ToastService } from '../../ui/toast.service';

const KIND_LABELS: Record<ComplianceKind, string> = {
  INSURANCE: 'Ασφάλιση κτιρίου',
  ELEVATOR_CERTIFICATE: 'Πιστοποιητικό ανελκυστήρα',
  FIRE_SAFETY: 'Πυρασφάλεια',
  OTHER: 'Λοιπά',
};

interface StatusChip {
  label: string;
  badgeClass: string;
}

@Component({
  selector: 'app-admin-compliance',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Πιστοποιητικά &amp; ασφάλειες</h1>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="card lg:col-span-1">
        <h2 class="card-title">
          {{ editingId() ? 'Επεξεργασία στοιχείου' : 'Νέο στοιχείο συμμόρφωσης' }}
        </h2>
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4">
          <div>
            <label class="label" for="kind">Είδος</label>
            <select id="kind" class="input" formControlName="kind">
              @for (option of kinds; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="title">Τίτλος</label>
            <input
              id="title"
              type="text"
              class="input"
              formControlName="title"
              placeholder="π.χ. Ασφάλιση κτιρίου 2026"
            />
            @if (submitted() && form.controls.title.invalid) {
              <p class="field-error">Ο τίτλος χρειάζεται τουλάχιστον 2 χαρακτήρες.</p>
            }
          </div>
          <div>
            <label class="label" for="providerName">Πάροχος (προαιρετικό)</label>
            <input id="providerName" type="text" class="input" formControlName="providerName" />
          </div>
          <div>
            <label class="label" for="policyNumber">Αριθμός συμβολαίου (προαιρετικό)</label>
            <input id="policyNumber" type="text" class="input" formControlName="policyNumber" />
          </div>
          <div>
            <label class="label" for="premium">Ασφάλιστρο € (προαιρετικό)</label>
            <input
              id="premium"
              type="number"
              min="0"
              step="0.01"
              class="input"
              formControlName="premium"
            />
            @if (submitted() && form.controls.premium.invalid) {
              <p class="field-error">Δώστε έγκυρο ποσό.</p>
            }
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="startsOn">Έναρξη</label>
              <input id="startsOn" type="date" class="input" formControlName="startsOn" />
            </div>
            <div>
              <label class="label" for="endsOn">Λήξη</label>
              <input id="endsOn" type="date" class="input" formControlName="endsOn" />
            </div>
          </div>
          @if (submitted() && (form.controls.startsOn.invalid || form.controls.endsOn.invalid)) {
            <p class="field-error">Η έναρξη και η λήξη είναι υποχρεωτικές.</p>
          }
          @if (submitted() && datesReversed()) {
            <p class="field-error">Η λήξη πρέπει να είναι μετά την έναρξη.</p>
          }
          <div>
            <label class="label" for="notes">Σημειώσεις (προαιρετικές)</label>
            <textarea id="notes" rows="2" class="input" formControlName="notes"></textarea>
          </div>
          <div class="flex items-center gap-2">
            <button type="submit" class="btn btn-primary self-start" [disabled]="saving()">
              {{ editingId() ? 'Αποθήκευση' : 'Προσθήκη' }}
            </button>
            @if (editingId()) {
              <button type="button" class="btn btn-secondary" (click)="resetForm()">Άκυρο</button>
            }
          </div>
        </form>
      </div>

      <div class="lg:col-span-2">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div class="w-56">
            <label class="label" for="kindFilter">Φίλτρο είδους</label>
            <select
              id="kindFilter"
              class="input"
              [formControl]="kindFilter"
              (change)="reload()"
            >
              <option value="">Όλα τα είδη</option>
              @for (option of kinds; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </div>
          <button
            type="button"
            class="btn btn-secondary"
            (click)="runCheck()"
            [disabled]="checking()"
          >
            Έλεγχος λήξεων
          </button>
        </div>
        @if (checkResult(); as result) {
          <p class="mb-3 text-sm text-slate-600">
            Ενημερώθηκαν {{ result.notified }} διαχειριστές · παραλείφθηκαν
            {{ result.skipped }} ήδη ειδοποιημένες περιπτώσεις.
          </p>
        }

        <div class="card overflow-x-auto p-0">
          @if (loadError()) {
            <div class="border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Αποτυχία φόρτωσης μητρώου συμμόρφωσης.
            </div>
          }
          <table class="data-table">
            <thead>
              <tr>
                <th>Τίτλος</th>
                <th>Είδος</th>
                <th>Ασφάλιστρο</th>
                <th>Λήξη</th>
                <th>Κατάσταση</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (item of items(); track item.id) {
                <tr>
                  <td>
                    <span class="font-medium">{{ item.title }}</span>
                    @if (item.providerName || item.policyNumber) {
                      <span class="block text-xs text-slate-500">
                        {{ item.providerName || '—' }}
                        @if (item.policyNumber) {
                          · {{ item.policyNumber }}
                        }
                      </span>
                    }
                  </td>
                  <td>{{ kindLabel(item.kind) }}</td>
                  <td>{{ item.premiumCents !== undefined && item.premiumCents !== null ? euros(item.premiumCents) : '—' }}</td>
                  <td>{{ formatDate(item.endsOn) }}</td>
                  <td>
                    <span class="badge" [class]="status(item).badgeClass">
                      {{ status(item).label }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap">
                    <button
                      type="button"
                      class="btn btn-secondary !px-2 !py-1 text-xs"
                      (click)="edit(item)"
                    >
                      Επεξεργασία
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary ml-1 !px-2 !py-1 text-xs text-red-600"
                      (click)="remove(item)"
                    >
                      Διαγραφή
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="py-8 text-center text-slate-500">
                    Δεν υπάρχουν καταχωρήσεις συμμόρφωσης ακόμη.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class AdminCompliancePage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly complianceApi = inject(ComplianceApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;

  protected readonly items = signal<ComplianceItemDto[]>([]);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly checking = signal(false);
  protected readonly loadError = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly checkResult = signal<{ notified: number; skipped: number } | null>(null);

  protected readonly kinds = (
    Object.keys(KIND_LABELS) as ComplianceKind[]
  ).map((value) => ({ value, label: KIND_LABELS[value] }));

  protected readonly kindFilter = this.fb.nonNullable.control('');

  protected readonly form = this.fb.nonNullable.group({
    kind: this.fb.nonNullable.control<ComplianceKind>('INSURANCE'),
    title: ['', [Validators.required, Validators.minLength(2)]],
    providerName: [''],
    policyNumber: [''],
    premium: this.fb.nonNullable.control<number | null>(null, {
      validators: [Validators.min(0)],
    }),
    startsOn: ['', Validators.required],
    endsOn: ['', Validators.required],
    notes: [''],
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

  protected kindLabel(kind: ComplianceKind): string {
    return KIND_LABELS[kind] ?? kind;
  }

  protected status(item: ComplianceItemDto): StatusChip {
    if (item.expired) {
      const days = Math.abs(item.daysLeft);
      return {
        label: `Έχει λήξει (${days} ${days === 1 ? 'ημέρα' : 'ημέρες'} πριν)`,
        badgeClass: 'bg-red-100 text-red-700',
      };
    }
    if (item.daysLeft <= 30) {
      return {
        label: `Λήγει σύντομα (${item.daysLeft} ${this.dayWord(item.daysLeft)})`,
        badgeClass: 'bg-amber-100 text-amber-800',
      };
    }
    return { label: `Έγκυρο (${item.daysLeft} ${this.dayWord(item.daysLeft)})`, badgeClass: 'bg-green-100 text-green-700' };
  }

  protected datesReversed(): boolean {
    const { startsOn, endsOn } = this.form.getRawValue();
    return startsOn !== '' && endsOn !== '' && endsOn <= startsOn;
  }

  protected save(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.datesReversed() || this.saving()) {
      return;
    }
    const value = this.form.getRawValue();
    let premiumCents: number | undefined;
    if (value.premium !== null) {
      const cents = eurosToCents(value.premium);
      if (!Number.isFinite(cents) || cents < 0) return;
      premiumCents = cents;
    }

    const payload = {
      kind: value.kind,
      title: value.title.trim(),
      ...(value.providerName.trim()
        ? { providerName: value.providerName.trim() }
        : {}),
      ...(value.policyNumber.trim()
        ? { policyNumber: value.policyNumber.trim() }
        : {}),
      ...(premiumCents !== undefined ? { premiumCents } : {}),
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      ...(value.notes.trim() ? { notes: value.notes.trim() } : {}),
    };

    const editing = this.editingId();
    this.saving.set(true);
    const request$ = editing
      ? this.complianceApi.update(editing, payload)
      : this.complianceApi.create(this.buildingId, payload);
    request$.subscribe({
      next: () => {
        this.toast.success(
          editing ? 'Η καταχώρηση ενημερώθηκε.' : 'Η καταχώρηση προστέθηκε.',
        );
        this.saving.set(false);
        this.resetForm();
        this.reload();
      },
      error: () => {
        this.toast.error('Η αποθήκευση απέτυχε.');
        this.saving.set(false);
      },
    });
  }

  protected edit(item: ComplianceItemDto): void {
    this.editingId.set(item.id);
    this.submitted.set(false);
    this.form.patchValue({
      kind: item.kind,
      title: item.title,
      providerName: item.providerName ?? '',
      policyNumber: item.policyNumber ?? '',
      premium:
        item.premiumCents === null || item.premiumCents === undefined
          ? null
          : item.premiumCents / 100,
      startsOn: item.startsOn.slice(0, 10),
      endsOn: item.endsOn.slice(0, 10),
      notes: item.notes ?? '',
    });
  }

  protected resetForm(): void {
    this.editingId.set(null);
    this.submitted.set(false);
    this.form.reset({
      kind: 'INSURANCE',
      title: '',
      providerName: '',
      policyNumber: '',
      premium: null,
      startsOn: '',
      endsOn: '',
      notes: '',
    });
  }

  protected remove(item: ComplianceItemDto): void {
    this.complianceApi
      .delete(item.id)
      .pipe(catchError(() => EMPTY))
      .subscribe(() => this.reload());
    this.toast.info(`Διαγράφηκε: ${item.title}`);
  }

  protected runCheck(): void {
    if (!this.buildingId || this.checking()) return;
    this.checking.set(true);
    this.complianceApi.checkExpiries(this.buildingId).subscribe({
      next: (result) => {
        this.checking.set(false);
        this.checkResult.set(result);
        if (result.notified > 0) {
          this.toast.success(
            `Στάλθηκαν ${result.notified} ειδοποιήσεις λήξης.`,
          );
        } else {
          this.toast.info('Καμία νέα ειδοποίηση — όλα τα δεδομένα ήταν ενημερωμένα.');
        }
      },
      error: () => {
        this.checking.set(false);
        this.toast.error('Ο έλεγχος λήξεων απέτυχε.');
      },
    });
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }

  private dayWord(days: number): string {
    return days === 1 ? 'ημέρα' : 'ημέρες';
  }

  protected reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    const kind = this.kindFilter.value;
    this.complianceApi
      .list(this.buildingId, kind || undefined)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          return EMPTY;
        }),
      )
      .subscribe((items) => this.items.set(items));
  }
}
