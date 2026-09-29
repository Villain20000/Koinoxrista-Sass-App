import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, forkJoin } from 'rxjs';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  AccountantApiService,
  AccountantAccessDto,
} from '../../core/api/accountant-api.service';
import { ToastService } from '../../ui/toast.service';

/**
 * ADMIN: manage external λογιστής (ACCOUNTANT) seats for the active building —
 * list grants, grant by email (existing ACCOUNTANT users only), revoke.
 * Desired route: /admin/accountants
 */
@Component({
  selector: 'app-admin-accountants',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Λογιστές</h1>

    <form [formGroup]="form" (ngSubmit)="submit()" class="card mb-6 grid gap-4 sm:grid-cols-4">
      <div class="sm:col-span-2">
        <label class="label" for="accountant-email">Email λογιστή</label>
        <input
          id="accountant-email"
          type="email"
          class="input"
          formControlName="email"
          placeholder="logistis@accounting.gr"
        />
        @if (submitted() && form.controls.email.invalid) {
          <p class="field-error">Δώστε ένα έγκυρο email.</p>
        }
      </div>
      <div class="flex items-end justify-end sm:col-span-2">
        <button type="submit" class="btn btn-primary" [disabled]="saving()">
          {{ saving() ? 'Προσθήκη…' : 'Παραχώρηση πρόσβασης' }}
        </button>
      </div>
    </form>

    @if (loading()) {
      <div class="card animate-pulse">
        <div class="h-4 w-1/3 rounded bg-slate-200"></div>
        <div class="mt-3 h-3 w-full rounded bg-slate-100"></div>
      </div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης. Δοκιμάστε ξανά.
      </div>
    } @else {
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Λογιστής</th>
              <th>Email</th>
              <th>Παραχωρήθηκε</th>
              <th class="text-right">Ενέργειες</th>
            </tr>
          </thead>
          <tbody>
            @for (access of accesses(); track access.id) {
              <tr>
                <td class="font-medium">
                  {{ displayName(access) }}
                </td>
                <td>{{ access.accountantEmail }}</td>
                <td>{{ formatDate(access.createdAt) }}</td>
                <td class="text-right">
                  <button
                    type="button"
                    class="btn btn-secondary !py-1 text-xs"
                    [disabled]="revokingId() !== null"
                    (click)="revoke(access)"
                  >
                    {{ revokingId() === access.id ? 'Ανάκληση…' : 'Ανάκληση' }}
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="4" class="py-8 text-center text-slate-500">
                  Κανένας λογιστής δεν έχει πρόσβαση ακόμη.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AdminAccountantsPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly accountantApi = inject(AccountantApiService);
  private readonly toast = inject(ToastService);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected readonly accesses = signal<AccountantAccessDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly revokingId = signal<string | null>(null);

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

  protected reload(): void {
    if (!this.buildingId) return;
    this.loading.set(true);
    this.error.set(false);
    forkJoin({
      accesses: this.accountantApi.listAccesses(this.buildingId),
    })
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ accesses }) => {
        this.accesses.set(accesses);
        this.loading.set(false);
      });
  }

  protected submit(): void {
    this.submitted.set(true);
    if (!this.buildingId || this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.accountantApi
      .grant(this.buildingId, this.form.getRawValue().email.trim())
      .pipe(
        catchError(() => {
          this.toast.error('Αποτυχία παραχώρησης. Ελέγξτε το email.');
          this.saving.set(false);
          return EMPTY;
        }),
      )
      .subscribe((access) => {
        this.toast.success(`Προστέθηκε ο ${access.accountantEmail}`);
        this.form.reset();
        this.submitted.set(false);
        this.saving.set(false);
        this.reload();
      });
  }

  protected revoke(access: AccountantAccessDto): void {
    if (!this.buildingId || this.revokingId() !== null) return;
    this.revokingId.set(access.id);
    this.accountantApi
      .revoke(this.buildingId, access.id)
      .pipe(
        catchError(() => {
          this.toast.error('Αποτυχία ανάκλησης.');
          this.revokingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success(`Αναιρέθηκε η πρόσβαση του ${access.accountantEmail}`);
        this.revokingId.set(null);
        this.reload();
      });
  }

  protected displayName(access: AccountantAccessDto): string {
    const name = [access.accountantFirstName, access.accountantLastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || access.accountantEmail;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }
}
