import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { EMPTY, catchError } from 'rxjs';
import {
  BillingCycle,
  FeatureFlag,
  FEATURES_BY_TIER,
  SUBSCRIPTION_TIERS,
  SubscriptionDto,
  SubscriptionStatus,
  SubscriptionTier,
  TIER_PRICES_CENTS,
  periodTotalCents,
} from '@org/shared';
import { SubscriptionsApiService } from '../../core/api/subscriptions-api.service';
import { ConfirmModalComponent } from '../../ui/confirm-modal.component';
import { ToastService } from '../../ui/toast.service';
import { AnalyticsService } from '../../core/analytics.service';
import { formatEuros } from '../../ui/format';

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: 'Δοκιμαστική περίοδος',
  ACTIVE: 'Ενεργή',
  PAST_DUE: 'Σε καθυστέρηση',
  CANCELLED: 'Ακυρωμένη',
};

const TIER_LABELS: Record<SubscriptionTier, string> = {
  BASIC: 'Basic',
  PRO: 'Pro',
  PREMIUM: 'Premium',
};

const FEATURE_META: { flag: FeatureFlag; label: string }[] = [
  { flag: 'voting', label: 'Ηλεκτρονικές ψηφοφορίες' },
  { flag: 'documents', label: 'Προχωρημένη διαχείριση εγγράφων' },
  { flag: 'publicApi', label: 'Πρόσβαση σε API' },
  { flag: 'accountantExports', label: 'Εξαγωγές για λογιστή' },
];

@Component({
  selector: 'app-admin-subscription',
  imports: [ConfirmModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Συνδρομή</h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error() || !sub()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης συνδρομής.
      </div>
    } @else if (sub(); as s) {
      <div class="mb-6 grid gap-4 lg:grid-cols-2">
        <div class="card">
          <div class="flex items-center justify-between">
            <h2 class="card-title">Κατάσταση</h2>
            <span class="badge" [class]="tierBadgeCls(s.tier)">
              {{ tierLabel(s.tier) }}
            </span>
          </div>
          <dl class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-slate-500">Κατάσταση πληρωμής</dt>
              <dd
                [class]="
                  s.derivedStatus === 'PAST_DUE'
                    ? 'font-medium text-red-700'
                    : 'font-medium text-slate-900'
                "
              >
                {{ statusLabel(s.derivedStatus) }}
              </dd>
            </div>
            @if (s.derivedStatus === 'TRIALING' && trialDaysLeft() !== null) {
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Λήξη δοκιμής</dt>
                <dd class="font-medium text-slate-900">
                  σε {{ trialDaysLeft() }} ημέρες
                </dd>
              </div>
            }
            @if (period(); as p) {
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Τρέχουσα περίοδος</dt>
                <dd class="font-medium text-slate-900">
                  {{ fmtDate(p[0]) }} – {{ fmtDate(p[1]) }}
                </dd>
              </div>
            }
            @if (s.cancelAt) {
              <div class="flex justify-between gap-4">
                <dt class="text-slate-500">Προγραμματισμένη λήξη</dt>
                <dd class="font-medium text-red-700">
                  {{ fmtDate(s.cancelAt) }}
                </dd>
              </div>
            }
            <div class="flex justify-between gap-4">
              <dt class="text-slate-500">Επόμενη χρέωση</dt>
              <dd class="font-semibold text-slate-900">
                {{ euros(s.nextChargeCents) }} /
                {{ s.billingCycle === 'MONTHLY' ? 'μήνα' : 'έτος' }}
              </dd>
            </div>
          </dl>
          <div class="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              (click)="activate()"
              [disabled]="busy()"
            >
              Ενεργοποίηση περιόδου
            </button>
            @if (s.status !== 'CANCELLED') {
              <button
                type="button"
                class="btn btn-danger"
                (click)="confirming.set(true)"
                [disabled]="busy()"
              >
                Ακύρωση συνδρομής
              </button>
            }
          </div>
        </div>

        <div class="card">
          <div class="flex items-center justify-between">
            <h2 class="card-title">Δυνατότητες πακέτου</h2>
            <span class="text-sm text-slate-500">
              {{ s.units }} διαμερίσματα
            </span>
          </div>
          <ul class="mt-4 space-y-2 text-sm">
            @for (feature of features; track feature.flag) {
              <li class="flex items-center justify-between gap-4">
                <span>{{ feature.label }}</span>
                <span
                  [class]="
                    flags()[feature.flag]
                      ? 'font-medium text-emerald-700'
                      : 'text-slate-400'
                  "
                >
                  {{ flags()[feature.flag] ? 'Διαθέσιμο' : 'Κλειδωμένο' }}
                </span>
              </li>
            }
          </ul>
        </div>
      </div>

      <h2 class="mb-3 text-base font-semibold text-slate-900">Πακέτα</h2>
      <div class="grid gap-4 md:grid-cols-3">
        @for (tier of tiers; track tier) {
          <div
            class="card flex flex-col"
            [class.border-indigo-300]="s.tier === tier"
          >
            <div class="flex items-baseline justify-between">
              <h3 class="font-semibold text-slate-900">
                {{ tierLabel(tier) }}
              </h3>
              @if (s.tier === tier) {
                <span class="text-xs font-semibold text-indigo-700">
                  Τρέχον πακέτο
                </span>
              }
            </div>
            <p class="mt-1 text-sm text-slate-600">
              {{ euros(TIER_PRICES_CENTS[tier]) }} ανά διαμέρισμα / μήνα
            </p>
            <dl class="mt-3 space-y-1 text-sm text-slate-700">
              <div class="flex justify-between">
                <dt>Μηνιαίο σύνολο</dt>
                <dd class="font-medium">
                  {{ euros(monthlyTotal(tier)) }}
                </dd>
              </div>
              <div class="flex justify-between">
                <dt>Ετήσιο σύνολο (−15%)</dt>
                <dd class="font-medium">
                  {{ euros(annualTotal(tier)) }}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              class="btn mt-4 self-start"
              [class.btn-primary]="cycle() === 'MONTHLY'"
              [class.btn-secondary]="cycle() === 'ANNUAL'"
              (click)="chooseTier(tier)"
              [disabled]="busy()"
            >
              Επιλογή {{ tierLabel(tier) }} ({{
                cycle() === 'MONTHLY' ? 'μηνιαία' : 'ετήσια'
              }})
            </button>
          </div>
        }
      </div>

      <div class="mt-4 flex items-center gap-2 text-sm">
        <span class="text-slate-500">Κύκλος χρέωσης:</span>
        <button
          type="button"
          class="btn"
          [class.btn-primary]="cycle() === 'MONTHLY'"
          [class.btn-secondary]="cycle() === 'ANNUAL'"
          (click)="cycle.set('MONTHLY')"
          [disabled]="busy()"
        >
          Μηνιαία
        </button>
        <button
          type="button"
          class="btn"
          [class.btn-primary]="cycle() === 'ANNUAL'"
          [class.btn-secondary]="cycle() === 'MONTHLY'"
          (click)="cycle.set('ANNUAL')"
          [disabled]="busy()"
        >
          Ετήσια (−15%)
        </button>
      </div>
    }

    @if (confirming()) {
      <app-confirm-modal
        title="Ακύρωση συνδρομής"
        message="Η συνδρομή θα μείνει χωρίς ανανέωση στο τέλος της τρέχουσας περιόδου. Συνέχεια;"
        [danger]="true"
        confirmLabel="Ακύρωση συνδρομής"
        (confirmed)="cancel()"
        (cancelled)="confirming.set(false)"
      />
    }
  `,
})
export class AdminSubscriptionPage implements OnInit {
  private readonly subscriptionsApi = inject(SubscriptionsApiService);
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly tiers = SUBSCRIPTION_TIERS;
  protected readonly features = FEATURE_META;
  protected readonly TIER_PRICES_CENTS = TIER_PRICES_CENTS;

  protected readonly sub = signal<SubscriptionDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  protected readonly cycle = signal<BillingCycle>('MONTHLY');

  protected readonly flags = computed(() => {
    const s = this.sub();
    return s ? FEATURES_BY_TIER[s.tier] : FEATURES_BY_TIER.BASIC;
  });

  protected readonly trialDaysLeft = computed(() => {
    const s = this.sub();
    if (!s?.trialEndsAt || s.derivedStatus !== 'TRIALING') return null;
    return Math.max(
      0,
      Math.ceil(
        (new Date(s.trialEndsAt).getTime() - Date.now()) /
          (24 * 60 * 60 * 1000),
      ),
    );
  });

  protected readonly period = computed(() => {
    const s = this.sub();
    if (!s?.currentPeriodStart || !s?.currentPeriodEnd) return null;
    return [s.currentPeriodStart, s.currentPeriodEnd] as const;
  });

  ngOnInit(): void {
    this.analytics.capture('plan_viewed');
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.error.set(false);
    this.subscriptionsApi
      .get()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((sub) => {
        this.sub.set(sub);
        this.loading.set(false);
      });
  }

  protected chooseTier(tier: SubscriptionTier): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.subscriptionsApi
      .changeTier({ tier, billingCycle: this.cycle() })
      .pipe(
        catchError(() => {
          this.toast.error('Η αλλαγή πακέτου απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((sub) => {
        this.sub.set(sub);
        this.cycle.set(sub.billingCycle);
        this.toast.success('Το πακέτο ενημερώθηκε.');
        this.busy.set(false);
      });
  }

  protected activate(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.subscriptionsApi
      .activate()
      .pipe(
        catchError(() => {
          this.toast.error('Η ενεργοποίηση απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((sub) => {
        this.sub.set(sub);
        this.toast.success('Η περίοδος ενεργοποιήθηκε.');
        this.busy.set(false);
      });
  }

  protected cancel(): void {
    this.confirming.set(false);
    if (this.busy()) return;
    this.busy.set(true);
    this.subscriptionsApi
      .cancel()
      .pipe(
        catchError(() => {
          this.toast.error('Η ακύρωση απέτυχε.');
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((sub) => {
        this.sub.set(sub);
        this.toast.info('Η συνδρομή ακυρώθηκε.');
        this.busy.set(false);
      });
  }

  protected monthlyTotal(tier: SubscriptionTier): number {
    return periodTotalCents(tier, 'MONTHLY', this.sub()?.units ?? 0);
  }

  protected annualTotal(tier: SubscriptionTier): number {
    return periodTotalCents(tier, 'ANNUAL', this.sub()?.units ?? 0);
  }

  protected tierLabel(tier: SubscriptionTier): string {
    return TIER_LABELS[tier];
  }

  protected statusLabel(status: SubscriptionStatus): string {
    return STATUS_LABELS[status];
  }

  protected tierBadgeCls(tier: SubscriptionTier): string {
    switch (tier) {
      case 'PREMIUM':
        return 'bg-violet-100 text-violet-800';
      case 'PRO':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  }

  protected fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }

  protected readonly euros = formatEuros;
}
