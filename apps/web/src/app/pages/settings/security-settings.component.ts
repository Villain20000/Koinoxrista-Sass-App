import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { EMPTY, catchError, finalize } from 'rxjs';
import { TwoFactorApiService } from '../../core/two-factor-api.service';
import {
  ActiveSessionDto,
  SessionsApiService,
} from '../../core/api/sessions-api.service';
import { AuthService } from '../../core/auth.service';
import { QrCodeComponent } from '../../ui/qr-code.component';
import { ToastService } from '../../ui/toast.service';

/**
 * Account-level 2FA settings: QR-based TOTP enrollment, one-time display of
 * the 10 recovery codes and password-confirmed disabling. Works for every
 * role; primarily intended for ADMINs.
 */
@Component({
  selector: 'app-security-settings',
  imports: [ReactiveFormsModule, QrCodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto w-full max-w-3xl px-4">
      <h1 class="mb-1 text-xl font-bold text-slate-900">Ασφάλεια</h1>
      <p class="mb-6 text-sm text-slate-500">
        Διαχείριση κωδικού πρόσβασης, email και ταυτότητας δύο παραγόντων (2FA).
      </p>

      <!-- ΑΛΛΑΓΗ ΚΩΔΙΚΟΥ -->
      <div class="card">
        <h2 class="mb-2 text-base font-semibold text-slate-900">
          Αλλαγή κωδικού πρόσβασης
        </h2>
        <form
          [formGroup]="passwordForm"
          (ngSubmit)="submitPassword()"
          class="flex flex-col gap-3"
        >
          <div>
            <label class="label" for="currentPassword">Τρέχων κωδικός</label>
            <input
              id="currentPassword"
              type="password"
              autocomplete="current-password"
              class="input"
              formControlName="currentPassword"
            />
          </div>
          <div>
            <label class="label" for="newPassword">Νέος κωδικός</label>
            <input
              id="newPassword"
              type="password"
              autocomplete="new-password"
              class="input"
              formControlName="newPassword"
            />
          </div>
          <div>
            <label class="label" for="confirmPassword">Επιβεβαίωση νέου κωδικού</label>
            <input
              id="confirmPassword"
              type="password"
              autocomplete="new-password"
              class="input"
              formControlName="confirmPassword"
            />
            @if (passwordForm.hasError('mismatch')) {
              <p class="mt-1 text-xs text-red-600">Οι κωδικοί δεν ταιριάζουν.</p>
            }
          </div>
          <div class="flex items-center gap-3">
            <button
              class="btn btn-primary"
              [disabled]="busy() || passwordForm.invalid"
            >
              Αλλαγή κωδικού
            </button>
            @if (passwordChanged()) {
              <span class="text-sm text-emerald-700">
                ✔ Ο κωδικός ενημερώθηκε. Άλλες συσκευές αποσυνδέθηκαν.
              </span>
            }
          </div>
        </form>
      </div>

      <!-- ΑΛΛΑΓΗ EMAIL -->
      <div class="card mt-6">
        <h2 class="mb-2 text-base font-semibold text-slate-900">
          Αλλαγή email
        </h2>
        <form
          [formGroup]="emailForm"
          (ngSubmit)="submitEmail()"
          class="flex flex-col gap-3"
        >
          <div>
            <label class="label" for="newEmail">Νέο email</label>
            <input
              id="newEmail"
              type="email"
              autocomplete="email"
              class="input"
              formControlName="newEmail"
            />
          </div>
          <div>
            <label class="label" for="emailPassword">Κωδικός πρόσβασης</label>
            <input
              id="emailPassword"
              type="password"
              autocomplete="current-password"
              class="input"
              formControlName="password"
            />
          </div>
          <button
            class="btn btn-primary"
            [disabled]="busy() || emailForm.invalid"
          >
            Αλλαγή email
          </button>
          @if (emailError()) {
            <p class="text-sm text-red-700">{{ emailError() }}</p>
          }
        </form>
      </div>

      <!-- 2FA -->
      <div class="card mt-6">
        <p class="mb-6 text-sm text-slate-500">
          Ελέγχος ταυτότητας δύο παραγόντων (2FA) για τον λογαριασμό σας.
        </p>
        @if (!enabled()) {
          <!-- ΕΝΕΡΓΟΠΟΙΗΣΗ -->
          <h2 class="mb-2 text-base font-semibold text-slate-900">
            Ενεργοποίηση 2FA
          </h2>

          @if (step() === 'idle') {
            <p class="mb-4 text-sm text-slate-600">
              Προστατεύστε τη σύνδεσή σας με έναν κωδικό από εφαρμογή
              ελέγχου ταυτότητας (Google Authenticator, Authy κ.λπ.).
            </p>
            <button class="btn btn-primary" [disabled]="busy()" (click)="startSetup()">
              Ξεκίναμε ρύθμιση
            </button>
          } @else {
            <ol class="mb-4 list-inside list-decimal space-y-3 text-sm text-slate-600">
              <li>
                Σκανάρετε τον κωδικό QR με την εφαρμογή σας ή πληκτρολογήστε
                το μυστικό κλειδί χειροκίνητα:
                <span class="ml-1 font-mono font-semibold text-slate-900 select-all">
                  {{ secret() }}
                </span>
              </li>
            </ol>

            @if (otpauthUri()) {
              <div class="mb-4 flex justify-center">
                <app-qr-code [value]="otpauthUri()" [size]="192" />
              </div>
            }

            <form
              [formGroup]="enableForm"
              (ngSubmit)="submitEnable()"
              class="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div class="grow">
                <label class="label" for="token">Κωδικός επαλήθευσης</label>
                <input
                  id="token"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  class="input font-mono tracking-widest"
                  formControlName="token"
                  placeholder="123456"
                />
              </div>
              <button class="btn btn-primary" [disabled]="busy()">
                Επιβεβαίωση & ενεργοποίηση
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="busy()"
                (click)="resetFlow()"
              >
                Άκυρο
              </button>
            </form>
          }
        }

        <!-- ΚΩΔΙΚΟΙ ΑΝΑΚΤΗΣΗΣ (εμφανίζονται ΜΙΑ φορά) -->
        @if (recoveryCodes().length > 0) {
          <div
            class="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4"
          >
            <h3 class="font-semibold text-amber-900">Κωδικοί ανάκτησης</h3>
            <p class="mt-1 mb-3 text-sm text-amber-800">
              Αποθηκεύστε τους τώρα σε ασφαλές μέρος. Κάθε κωδικός λειτουργεί
              μία φορά στη θέση του 6ψήφιου κωδικού και
              <strong>δεν θα εμφανιστεί ξανά</strong>.
            </p>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm text-slate-900 sm:grid-cols-5">
              @for (code of recoveryCodes(); track code) {
                <span>{{ code }}</span>
              }
            </div>
            <button
              type="button"
              class="btn btn-secondary mt-3"
              (click)="copyRecoveryCodes()"
            >
              Αντιγραφή στο πρόχειρο
            </button>
          </div>
        }

        @if (enabled() && recoveryCodes().length === 0) {
          <p class="text-sm text-emerald-700">
            ✔ Η δίακριψη δύο παραγόντων είναι ενεργή για τον λογαριασμό σας.
          </p>
        }

        <!-- ΑΠΕΝΕΡΓΟΠΟΙΗΣΗ -->
        @if (enabled()) {
          <hr class="my-6 border-slate-200" />
          <h2 class="mb-2 text-base font-semibold text-slate-900">
            Απενεργοποίηση 2FA
          </h2>
          <form
            [formGroup]="disableForm"
            (ngSubmit)="submitDisable()"
            class="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div class="grow">
              <label class="label" for="password">Τρέχων κωδικός πρόσβασης</label>
              <input
                id="password"
                type="password"
                autocomplete="current-password"
                class="input"
                formControlName="password"
              />
            </div>
            <button class="btn btn-danger" [disabled]="busy()">
              Απενεργοποίηση
            </button>
          </form>
        }

        @if (error()) {
          <div
            class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {{ error() }}
          </div>
        }
      </div>

      <!-- ΕΝΕΡΓΕΣ ΣΥΝΕΔΡΙΕΣ -->
      <div class="card mt-6">
        <h2 class="mb-2 text-base font-semibold text-slate-900">
          Ενεργές συνεδρίες
        </h2>
        <p class="mb-4 text-sm text-slate-500">
          Οι συσκευές που είναι συνδεδεμένες στον λογαριασμό σας. Η ανάκληση
          αποσυνδέει τη συσκευή στην επόμενη ανανέωση σύνδεσης.
        </p>

        @if (sessionsLoading()) {
          <p class="text-sm text-slate-500">Φόρτωση…</p>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (session of sessions(); track session.id) {
              <li
                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                [class.border-emerald-300]="session.isCurrent"
                [class.border-slate-200]="!session.isCurrent"
              >
                <div class="min-w-0">
                  <p class="font-medium text-slate-900">
                    {{ deviceLabel(session.userAgent) }}
                    @if (session.isCurrent) {
                      <span
                        class="badge ml-1 bg-emerald-100 text-emerald-800"
                      >Τρέχουσα</span>
                    }
                  </p>
                  <p class="text-xs text-slate-500">
                    Τελευταία χρήση: {{ when(session.lastUsedAt) }}
                    @if (session.ip) {
                      · IP: {{ session.ip }}
                    }
                  </p>
                </div>
                @if (!session.isCurrent) {
                  <button
                    type="button"
                    class="btn btn-danger !px-2 !py-1 text-xs"
                    [disabled]="sessionsBusy()"
                    (click)="revokeSession(session.id)"
                  >
                    Ανάκληση
                  </button>
                }
              </li>
            } @empty {
              <li class="text-sm text-slate-500">Δεν βρέθηκαν συνεδρίες.</li>
            }
          </ul>

          @if (otherSessions() > 0) {
            <button
              type="button"
              class="btn btn-secondary mt-3"
              [disabled]="sessionsBusy()"
              (click)="revokeOtherSessions()"
            >
              Ανάκληση όλων των άλλων συνεδριών
            </button>
          }
          @if (sessionsError()) {
            <p class="mt-3 text-sm text-red-700">{{ sessionsError() }}</p>
          }
        }
      </div>
    </div>
  `,
})
export class SecuritySettingsPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(TwoFactorApiService);
  private readonly sessionsApi = inject(SessionsApiService);
  private readonly toast = inject(ToastService);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Ενεργές συνεδρίες (συσκευές) του λογαριασμού. */
  protected readonly sessions = signal<ActiveSessionDto[]>([]);
  protected readonly sessionsLoading = signal(true);
  protected readonly sessionsBusy = signal(false);
  protected readonly sessionsError = signal<string | null>(null);

  protected readonly otherSessions = () =>
    this.sessions().filter((s) => !s.isCurrent).length;

  /** idle → qr (pending secret) → enabled. */
  protected readonly step = signal<'idle' | 'qr' | 'enabled'>('idle');
  protected readonly enabled = signal(
    this.auth.currentUser()?.twoFactorEnabled === true,
  );
  protected readonly secret = signal('');
  protected readonly otpauthUri = signal('');
  protected readonly recoveryCodes = signal<string[]>([]);

  protected readonly enableForm = this.fb.nonNullable.group({
    token: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected readonly disableForm = this.fb.nonNullable.group({
    password: ['', [Validators.required]],
  });

  /** Feature 7: change-password form (with client-side confirmation match). */
  protected readonly passwordForm = this.fb.nonNullable.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: [
        '',
        [Validators.required, Validators.minLength(8)],
      ],
      confirmPassword: ['', [Validators.required]],
    },
    {
      validators: (group) =>
        group.value.newPassword === group.value.confirmPassword
          ? null
          : { mismatch: true },
    },
  );
  protected readonly passwordChanged = signal(false);

  /** Feature 7: change-email form (re-auth with the current password). */
  protected readonly emailForm = this.fb.nonNullable.group({
    newEmail: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly emailError = signal<string | null>(null);

  protected submitPassword(): void {
    this.error.set(null);
    this.passwordChanged.set(false);
    if (this.passwordForm.invalid || this.busy()) return;
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.busy.set(true);
    this.auth
      .changePassword(currentPassword, newPassword)
      .pipe(
        catchError((err: unknown) => {
          const status = (err as { status?: number })?.status;
          this.error.set(
            status === 401
              ? 'Ο τρέχων κωδικός είναι λανθασμένος.'
              : 'Η αλλαγή κωδικού απέτυχε. Δοκιμάστε ξανά.',
          );
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
      )
      .subscribe(() => {
        this.passwordForm.reset({
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        });
        this.passwordChanged.set(true);
        this.toast.show('success', 'Ο κωδικός πρόσβασης άλλαξε.');
      });
  }

  protected submitEmail(): void {
    this.emailError.set(null);
    if (this.emailForm.invalid || this.busy()) return;
    const { newEmail, password } = this.emailForm.getRawValue();
    this.busy.set(true);
    this.auth
      .changeEmail(password, newEmail)
      .pipe(
        catchError((err: unknown) => {
          const status = (err as { status?: number })?.status;
          this.emailError.set(
            status === 409
              ? 'Αυτό το email χρησιμοποιείται ήδη.'
              : status === 401
                ? 'Λανθασμένος κωδικός πρόσβασης.'
                : 'Η αλλαγή email απέτυχε. Δοκιμάστε ξανά.',
          );
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
      )
      .subscribe((email) => {
        this.emailForm.reset({ newEmail: '', password: '' });
        this.auth.currentUser.update((user) =>
          user ? { ...user, email } : user,
        );
        this.toast.show('success', 'Το email άλλαξε.');
      });
  }

  protected startSetup(): void {
    this.error.set(null);
    this.busy.set(true);
    this.api
      .setup()
      .pipe(
        catchError(() => {
          this.error.set('Αποτυχία έναρξης ρύθμισης. Δοκιμάστε ξανά.');
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
      )
      .subscribe(({ secret, otpauthUri }) => {
        this.secret.set(secret);
        this.otpauthUri.set(otpauthUri);
        this.step.set('qr');
      });
  }

  protected submitEnable(): void {
    this.error.set(null);
    if (this.enableForm.invalid || this.busy()) return;
    const { token } = this.enableForm.getRawValue();
    this.busy.set(true);
    this.api
      .enable(this.secret(), token.trim())
      .pipe(
        catchError(() => {
          this.error.set(
            'Μη έγκυρος κωδικός επαλήθευσης — ελέγξτε την ώρα της συσκευής και δοκιμάστε ξανά.',
          );
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
      )
      .subscribe(({ recoveryCodes }) => {
        this.recoveryCodes.set(recoveryCodes);
        this.step.set('enabled');
        this.enabled.set(true);
        this.markCurrentUser(true);
        this.toast.show(
          'success',
          'Η διαπίστευση δύο παραγόντων ενεργοποιήθηκε.',
        );
      });
  }

  protected submitDisable(): void {
    this.error.set(null);
    if (this.disableForm.invalid || this.busy()) return;
    const { password } = this.disableForm.getRawValue();
    this.busy.set(true);
    this.api
      .disable(password)
      .pipe(
        catchError(() => {
          this.error.set('Λανθασμένος κωδικός πρόσβασης.');
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
      )
      .subscribe(() => {
        this.resetFlow();
        this.enabled.set(false);
        this.markCurrentUser(false);
        this.disableForm.reset({ password: '' });
        this.toast.show('success', 'Η διαπίστευση δύο παραγόντων απενεργοποιήθηκε.');
      });
  }

  protected copyRecoveryCodes(): void {
    void navigator.clipboard?.writeText(this.recoveryCodes().join('\n'));
    this.toast.show('info', 'Οι κωδικοί αντιγράφηκαν στο πρόχειρο.');
  }

  protected resetFlow(): void {
    this.step.set(this.enabled() ? 'enabled' : 'idle');
    this.secret.set('');
    this.otpauthUri.set('');
    this.enableForm.reset({ token: '' });
  }

  private markCurrentUser(enabled: boolean): void {
    this.auth.currentUser.update((user) =>
      user ? { ...user, twoFactorEnabled: enabled } : user,
    );
  }

  ngOnInit(): void {
    this.loadSessions();
  }

  protected loadSessions(): void {
    this.sessionsLoading.set(true);
    this.sessionsApi
      .list()
      .pipe(
        catchError(() => {
          this.sessionsError.set(
            'Η φόρτωση των συνεδριών απέτυχε. Δοκιμάστε να ανανεώσετε.',
          );
          return EMPTY;
        }),
        finalize(() => this.sessionsLoading.set(false)),
      )
      .subscribe((sessions) => this.sessions.set(sessions));
  }

  protected revokeSession(sessionId: string): void {
    this.sessionsBusy.set(true);
    this.sessionsApi
      .revoke(sessionId)
      .pipe(finalize(() => this.sessionsBusy.set(false)))
      .subscribe(() => {
        this.sessions.update((all) =>
          all.filter((session) => session.id !== sessionId),
        );
        this.toast.show('success', 'Η συνεδρία ανακλήθηκε.');
      });
  }

  protected revokeOtherSessions(): void {
    this.sessionsBusy.set(true);
    this.sessionsApi
      .revokeOthers()
      .pipe(finalize(() => this.sessionsBusy.set(false)))
      .subscribe(({ revoked }) => {
        this.sessions.update((all) => all.filter((s) => s.isCurrent));
        this.toast.show('success', `Ανακλήθηκαν ${revoked} συνεδρίες.`);
      });
  }

  /** Short Greek-friendly device label from the stored User-Agent (pure). */
  protected deviceLabel(userAgent: string | null): string {
    if (!userAgent) return 'Άγνωστη συσκευή';
    const ua = userAgent;
    const browser = /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Πρόγραμμα';
    const os = /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
    return os ? `${browser} · ${os}` : browser;
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString('el-GR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }
}
