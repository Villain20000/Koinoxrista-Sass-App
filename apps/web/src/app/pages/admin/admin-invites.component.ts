import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, catchError } from 'rxjs';
import type { InviteDto, Role } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { InvitesApiService } from '../../core/api/invites-api.service';
import { UnitWithOwners, UnitsApiService } from '../../core/api/units-api.service';
import { ToastService } from '../../ui/toast.service';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Διαχειριστής',
  RESIDENT: 'Ένοικος',
  PROVIDER: 'Τεχνικός',
};

type InviteStatus = 'pending' | 'accepted' | 'expired';

const STATUS_LABELS: Record<InviteStatus, string> = {
  pending: 'Εκκρεμής',
  accepted: 'Αποδεκτή',
  expired: 'Έληξε',
};

const STATUS_CLASSES: Record<InviteStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-slate-200 text-slate-600',
};

@Component({
  selector: 'app-admin-invites',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Προσκλήσεις</h1>

    @if (createdLink(); as link) {
      <div class="card mb-6 border-emerald-200 bg-emerald-50">
        <h2 class="card-title text-emerald-900">Ο σύνδεσμος πρόσκλησης δημιουργήθηκε</h2>
        <p class="mb-3 text-sm text-emerald-800">
          Στείλτε τον παρακάτω σύνδεσμο στον προσκεκλημένο. Είναι μοναδικής χρήσης.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="invite-link"
            type="text"
            readonly
            class="input flex-1 font-mono text-xs"
            [value]="link"
          />
          <div class="flex gap-2">
            <button type="button" class="btn btn-primary" (click)="copyLink()">
              {{ copied() ? 'Αντιγράφηκε ✓' : 'Αντιγραφή' }}
            </button>
            <button type="button" class="btn btn-secondary" (click)="dismissLink()">
              Κλείσιμο
            </button>
          </div>
        </div>
      </div>
    }

    <form [formGroup]="form" (ngSubmit)="submit()" class="card mb-6 grid gap-4 sm:grid-cols-5">
      <div class="sm:col-span-2">
        <label class="label" for="email">Email</label>
        <input id="email" type="email" class="input" formControlName="email" placeholder="name@example.gr" />
        @if (submitted() && form.controls.email.invalid) {
          <p class="field-error">Δώστε ένα έγκυρο email.</p>
        }
      </div>
      <div>
        <label class="label" for="role">Ρόλος</label>
        <select id="role" class="input" formControlName="role">
          @for (r of roleOptions; track r) {
            <option [value]="r">{{ roleLabels[r] }}</option>
          }
        </select>
      </div>
      <div>
        <label class="label" for="unitId">Διαμέρισμα</label>
        <select id="unitId" class="input" formControlName="unitId" [disabled]="!needsUnit()">
          <option value="">—</option>
          @for (u of units(); track u.id) {
            <option [value]="u.id">{{ u.label }}</option>
          }
        </select>
        @if (submitted() && needsUnit() && !form.controls.unitId.value) {
          <p class="field-error">Οι ένοικοι απαιτούν διαμέρισμα.</p>
        }
      </div>
      <div>
        <label class="label" for="expiresInDays">Λήξη (ημέρες)</label>
        <input id="expiresInDays" type="number" min="1" max="30" step="1" class="input" formControlName="expiresInDays" />
        @if (submitted() && form.controls.expiresInDays.invalid) {
          <p class="field-error">Από 1 έως 30 ημέρες.</p>
        }
      </div>
      <div class="flex items-end justify-end sm:col-span-5">
        <button type="submit" class="btn btn-primary" [disabled]="saving()">
          {{ saving() ? 'Δημιουργία…' : 'Νέα πρόσκληση' }}
        </button>
      </div>
    </form>

    @if (loading()) {
      <div class="card animate-pulse">
        <div class="h-4 w-1/3 rounded bg-slate-200"></div>
        <div class="mt-3 h-3 w-full rounded bg-slate-100"></div>
        <div class="mt-2 h-3 w-5/6 rounded bg-slate-100"></div>
      </div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης προσκλήσεων. Δοκιμάστε ξανά.
      </div>
    } @else {
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Ρόλος</th>
              <th>Διαμέρισμα</th>
              <th>Κατάσταση</th>
              <th>Δημιουργήθηκε</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (invite of invites(); track invite.id) {
              <tr>
                <td class="font-medium">{{ invite.email }}</td>
                <td>{{ roleLabel(invite.role) }}</td>
                <td>{{ invite.unit?.label ?? '—' }}</td>
                <td>
                  <span class="badge {{ statusClass(invite) }}">
                    {{ statusLabel(invite) }}
                  </span>
                </td>
                <td>{{ formatDate(invite.createdAt) }}</td>
                <td class="text-right">
                  @if (status(invite) === 'pending') {
                    <button
                      type="button"
                      class="btn btn-secondary !px-3 !py-1"
                      [disabled]="revokingId() !== null"
                      (click)="revoke(invite)"
                    >
                      Ανάκληση
                    </button>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="py-8 text-center text-slate-500">
                  Δεν υπάρχουν προσκλήσεις ακόμη.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AdminInvitesPage implements OnInit {
  private readonly invitesApi = inject(InvitesApiService);
  private readonly unitsApi = inject(UnitsApiService);
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleOptions = [
    'RESIDENT',
    'ADMIN',
    'PROVIDER',
    'ACCOUNTANT',
  ] as const;

  protected readonly invites = signal<InviteDto[]>([]);
  protected readonly units = signal<UnitWithOwners[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly revokingId = signal<string | null>(null);
  protected readonly createdLink = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['RESIDENT', Validators.required],
    unitId: [''],
    expiresInDays: [
      14,
      [Validators.required, Validators.min(1), Validators.max(30)],
    ],
  });

  private readonly roleValue = toSignal(this.form.controls.role.valueChanges, {
    initialValue: this.form.controls.role.value,
  });

  protected readonly needsUnit = computed(() => this.roleValue() === 'RESIDENT');

  private readonly buildingId = signal<string | null>(null);

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((building) => {
        this.buildingId.set(building.id);
        this.reloadInvites();
        this.reloadUnits();
      });
  }

  protected roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role;
  }

  protected status(invite: InviteDto): InviteStatus {
    if (invite.acceptedAt) return 'accepted';
    return new Date(invite.expiresAt).getTime() <= Date.now()
      ? 'expired'
      : 'pending';
  }

  protected statusLabel(invite: InviteDto): string {
    return STATUS_LABELS[this.status(invite)];
  }

  protected statusClass(invite: InviteDto): string {
    return STATUS_CLASSES[this.status(invite)];
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  protected submit(): void {
    this.submitted.set(true);
    const buildingId = this.buildingId();
    if (!buildingId || this.form.invalid || this.saving()) return;
    if (this.needsUnit() && !this.form.controls.unitId.value) return;

    const { email, role, unitId, expiresInDays } = this.form.getRawValue();
    const dto = {
      email,
      role: role as Role,
      ...(role === 'RESIDENT' && unitId ? { unitId } : {}),
      expiresInDays,
    };
    this.saving.set(true);
    this.invitesApi.create(buildingId, dto).subscribe({
      next: (invite) => {
        this.saving.set(false);
        this.createdLink.set(invite.inviteUrl);
        this.toast.success('Η πρόσκληση δημιουργήθηκε.');
        this.form.controls.email.reset('');
        this.reloadInvites();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(this.errorMessage(err));
      },
    });
  }

  protected copyLink(): void {
    const link = this.createdLink();
    if (!link) return;
    const markCopied = () => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(markCopied, () =>
        this.fallbackCopy(link, markCopied),
      );
    } else {
      this.fallbackCopy(link, markCopied);
    }
  }

  protected dismissLink(): void {
    this.createdLink.set(null);
  }

  protected revoke(invite: InviteDto): void {
    if (this.revokingId() !== null) return;
    this.revokingId.set(invite.id);
    this.invitesApi.revoke(invite.id).subscribe({
      next: () => {
        this.revokingId.set(null);
        this.toast.success('Η πρόσκληση ανακλήθηκε.');
        this.reloadInvites();
      },
      error: () => {
        this.revokingId.set(null);
        this.toast.error('Η ανάκληση απέτυχε.');
      },
    });
  }

  private errorMessage(err: unknown): string {
    const message = (err as { error?: { message?: string } })?.error?.message;
    if (typeof message === 'string') {
      if (message.includes('active invite')) {
        return 'Υπάρχει ήδη ενεργή πρόσκληση για αυτό το email.';
      }
      if (message.includes('already belongs')) {
        return 'Ο χρήστης ανήκει ήδη στο κτίριο.';
      }
      if (message.includes('Unit not found')) {
        return 'Το διαμέρισμα δεν βρέθηκε.';
      }
    }
    return 'Η δημιουργία πρόσκλησης απέτυχε.';
  }

  private fallbackCopy(text: string, done: () => void): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (document.execCommand('copy')) done();
    } finally {
      document.body.removeChild(textarea);
    }
  }

  private reloadInvites(): void {
    const buildingId = this.buildingId();
    if (!buildingId) return;
    this.loading.set(true);
    this.invitesApi
      .list(buildingId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((invites) => {
        this.invites.set(invites);
        this.loading.set(false);
      });
  }

  private reloadUnits(): void {
    const buildingId = this.buildingId();
    if (!buildingId) return;
    this.unitsApi
      .list(buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe((units) => this.units.set(units));
  }
}
