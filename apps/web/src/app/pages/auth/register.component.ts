import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
  ValidatorFn,
} from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { ReferralsApiService } from '../../core/api/referrals-api.service';
import { homeForRole } from '../../core/role.guard';
import { TranslatePipe } from '../../core/translate.pipe';

/** Mirrors the API rule: at least one digit. */
const containsDigit: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = String(control.value ?? '');
  return /\d/.test(value) ? null : { digit: true };
};

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto mt-10 w-full max-w-md px-4">
      <div class="card">
        <h1 class="mb-1 text-2xl font-bold text-slate-900">{{ 'register.title' | translate }}</h1>
        <p class="mb-6 text-sm text-slate-500">
          {{ 'register.intro' | translate }}
        </p>

        @if (inviteToken) {
          <div
            class="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800"
          >
            {{ 'register.inviteBanner' | translate }}
          </div>
        }

        @if (referralCode()) {
          <div
            class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"
          >
            {{ 'register.referralCode' | translate }}: <span class="font-semibold">{{ referralCode() }}</span>
            — {{ 'register.referralBannerBonus' | translate }}
          </div>
        }

        @if (errorKey()) {
          <div
            class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {{ errorKey() | translate }}
          </div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="firstName">{{ 'register.firstName' | translate }}</label>
              <input id="firstName" type="text" class="input" formControlName="firstName" />
              @if (submitted() && form.controls.firstName.invalid) {
                <p class="field-error">{{ 'register.firstNameRequired' | translate }}</p>
              }
            </div>
            <div>
              <label class="label" for="lastName">{{ 'register.lastName' | translate }}</label>
              <input id="lastName" type="text" class="input" formControlName="lastName" />
              @if (submitted() && form.controls.lastName.invalid) {
                <p class="field-error">{{ 'register.lastNameRequired' | translate }}</p>
              }
            </div>
          </div>
          <div>
            <label class="label" for="email">Email</label>
            <input id="email" type="email" class="input" formControlName="email" />
            @if (submitted() && form.controls.email.invalid) {
              <p class="field-error">{{ 'register.invalidEmail' | translate }}</p>
            }
          </div>
          <div>
            <label class="label" for="password">{{ 'register.password' | translate }}</label>
            <input
              id="password"
              type="password"
              class="input"
              formControlName="password"
            />
            @if (submitted() && form.controls.password.errors?.['required']) {
              <p class="field-error">{{ 'register.passwordRequired' | translate }}</p>
            }
            @if (submitted() && form.controls.password.errors?.['minlength']) {
              <p class="field-error">{{ 'register.passwordMinLength' | translate }}</p>
            }
            @if (submitted() && form.controls.password.errors?.['digit']) {
              <p class="field-error">{{ 'register.passwordDigit' | translate }}</p>
            }
          </div>
          <div>
            <label class="label" for="referralCode">{{ 'register.referralCodeLabel' | translate }}</label>
            <input
              id="referralCode"
              type="text"
              class="input uppercase"
              placeholder="BLD-XXXXXX"
              formControlName="referralCode"
            />
            <p class="mt-1 text-xs text-slate-500">
              {{ 'register.referralHint' | translate }}
            </p>
            @if (submitted() && form.controls.referralCode.invalid) {
              <p class="field-error">{{ 'register.referralCodePattern' | translate }}</p>
            }
          </div>
          <button type="submit" class="btn btn-primary" [disabled]="loading()">
            {{ loading() ? ('register.creating' | translate) : ('register.create' | translate) }}
          </button>
        </form>

        <p class="mt-4 text-sm text-slate-500">
          {{ 'register.hasAccount' | translate }}
          <a routerLink="/login" class="font-medium text-slate-900 hover:underline">
            {{ 'register.loginLink' | translate }}
          </a>
        </p>
      </div>
    </div>
  `,
})
export class RegisterPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Raw invite token from /register?invite=…; passed through to the API. */
  protected readonly inviteToken: string | null =
    this.route.snapshot.queryParamMap.get('invite');

  /** Referral code from /register?ref=BLD-XXXXXX; auto-prefilled. */
  protected readonly referralCode = signal<string>(
    (this.route.snapshot.queryParamMap.get('ref') ?? '').trim().toUpperCase(),
  );

  protected readonly submitted = signal(false);
  protected readonly loading = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(8),
        Validators.maxLength(72),
        containsDigit,
      ],
    ],
    referralCode: [
      this.referralCode(),
      [Validators.pattern(/^[A-Za-z]{3}-[A-Za-z0-9]{6}$/)],
    ],
  });

  protected submit(): void {
    this.submitted.set(true);
    this.errorKey.set(null);
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    const { referralCode, ...payload } = this.form.getRawValue();
    const effectiveCode = referralCode || this.referralCode();
    this.auth
      .register({
        ...payload,
        ...(effectiveCode ? { referralCode: effectiveCode } : {}),
        ...(this.inviteToken ? { inviteToken: this.inviteToken } : {}),
      })
      .subscribe({
      next: () => {
        // Carry the code to subscription activation — buildings do not exist
        // yet at signup, so rewards are granted when the building goes live.
        ReferralsApiService.stashPendingCode(effectiveCode);
        this.analytics.capture('register_completed');
        void this.router.navigateByUrl(homeForRole(this.auth.role));
      },
      error: () => {
        this.errorKey.set('register.errorGeneric');
        this.loading.set(false);
      },
    });
  }
}
