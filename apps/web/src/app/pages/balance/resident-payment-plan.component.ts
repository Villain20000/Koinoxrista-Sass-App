import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { EMPTY, catchError } from 'rxjs';
import type { InstallmentDto, PaymentPlanDto } from '@org/shared';
import {
  PaymentPlansApiService,
  paymentPlanStatusCls,
  paymentPlanStatusLabel,
} from '../../core/api/payment-plans-api.service';
import { formatEuros } from '../../ui/format';

/** Timeline state of one installment (pure). */
export type InstallmentTimelineState = 'paid' | 'overdue' | 'upcoming';

export function installmentState(installment: InstallmentDto): InstallmentTimelineState {
  if (installment.paidCents >= installment.amountCents) return 'paid';
  return installment.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10)
    ? 'overdue'
    : 'upcoming';
}

/** Greek label for a timeline state (pure). */
export function timelineStateLabel(state: InstallmentTimelineState): string {
  switch (state) {
    case 'paid':
      return 'Εξοφλημένο';
    case 'overdue':
      return 'Σε καθυστέρηση';
    default:
      return 'Εκκρεμεί';
  }
}

@Component({
  selector: 'app-resident-payment-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @media print {
      ::ng-deep body.app-print-plan app-layout header,
      ::ng-deep body.app-print-plan app-layout aside {
        display: none !important;
      }
      ::ng-deep body.app-print-plan app-layout main {
        margin-left: 0 !important;
        padding: 0 !important;
      }
    }
  `,
  template: `
    <div class="print:hidden mx-auto max-w-3xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-bold text-slate-900">Πρόγραμμα εξόφλησης</h1>
        @if (plan(); as p) {
          <button type="button" class="btn btn-secondary" (click)="printSheet()">
            Εκτύπωση
          </button>
        }
      </div>
    </div>

    @if (loading()) {
      <div class="card mx-auto max-w-3xl text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card mx-auto max-w-3xl border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης προγράμματος. Δεν υπάρχει ενεργό πρόγραμμα ή δοκιμάστε ξανά.
      </div>
    } @else if (plan(); as plan) {
      <div class="mx-auto max-w-3xl">
        <!-- Summary -->
        <section class="card mb-6 p-8 print:border-0 print:p-0 print:shadow-none">
          <header class="mb-4 border-b border-slate-200 pb-4">
            <h2 class="text-lg font-bold text-slate-900">Τμηματοποίηση οφειλής</h2>
            <p class="mt-1 text-sm text-slate-600">
              Διαμέρισμα {{ plan.unitLabel || '—' }} ·
              {{ plan.installmentCount }} δόσεις
            </p>
          </header>

          <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt class="text-xs text-slate-500">Σύνολο οφειλής</dt>
              <dd class="mt-1 font-semibold text-slate-900">{{ euros(plan.totalCents) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Εξοφλημένο</dt>
              <dd class="mt-1 font-semibold text-green-700">{{ euros(plan.paidCents ?? 0) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Υπόλοιπο</dt>
              <dd class="mt-1 font-semibold" [class.text-red-700]="planRemaining() > 0">
                {{ euros(planRemaining()) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Κατάσταση</dt>
              <dd class="mt-1">
                <span [class]="'badge ' + statusCls(plan.status)">
                  {{ statusLabel(plan.status) }}
                </span>
              </dd>
            </div>
          </dl>

          <div class="mt-5 h-2 rounded-full bg-slate-200">
            <div
              class="h-2 rounded-full bg-emerald-500"
              [style.width.%]="progress()"
            ></div>
          </div>
          <p class="mt-1 text-right text-xs text-slate-500">{{ progress() }}% εξοφλημένο</p>
        </section>

        <!-- Timeline -->
        <ol class="relative ml-3 border-l-2 border-slate-200">
          @for (inst of plan.installments ?? []; track inst.id) {
            <li class="mb-6 ml-6">
              <span
                class="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white"
                [class]="dotCls(inst)"
              ></span>
              <div class="card !mb-0 p-4">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <p class="font-medium text-slate-900">
                    Δόση {{ inst.seq }} από {{ plan.installmentCount }}
                  </p>
                  <p class="text-sm font-semibold" [class]="amountCls(inst)">
                    {{ euros(inst.amountCents) }}
                  </p>
                </div>
                <div class="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <p class="text-slate-500">Λήξη: {{ inst.dueDate.slice(0, 10) }}</p>
                  <p>
                    @if (inst.paidCents > 0 && inst.paidCents < inst.amountCents) {
                      <span class="text-slate-500">
                        Εξοφλήθηκε {{ euros(inst.paidCents) }} · απομένουν
                        {{ euros(inst.amountCents - inst.paidCents) }}
                      </span>
                    } @else {
                      <span [class]="stateTextCls(inst)">
                        {{ stateLabelOf(inst) }}
                      </span>
                    }
                  </p>
                </div>
                @if (inst.paidAt) {
                  <p class="mt-1 text-xs text-slate-400">
                    Εξοφλήθηκε στις {{ inst.paidAt.slice(0, 10) }}
                  </p>
                }
              </div>
            </li>
          }
        </ol>

        <p class="mt-6 text-xs text-slate-400">
          Εκτυπώθηκε στις {{ printedAt() }}
        </p>
      </div>
    }
  `,
})
export class ResidentPaymentPlanPage implements OnInit, OnDestroy {
  private readonly paymentPlansApi = inject(PaymentPlansApiService);
  private readonly document = inject(DOCUMENT);

  protected readonly euros = formatEuros;
  protected readonly statusLabel = paymentPlanStatusLabel;
  protected readonly statusCls = paymentPlanStatusCls;

  protected readonly plan = signal<PaymentPlanDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly printedAt = signal('');

  protected readonly planRemaining = computed(
    () => this.plan()?.remainingCents ?? 0,
  );

  protected readonly progress = computed(() => {
    const plan = this.plan();
    if (!plan || plan.totalCents <= 0) return 0;
    return Math.min(
      100,
      Math.round(((plan.paidCents ?? 0) / plan.totalCents) * 100),
    );
  });

  ngOnInit(): void {
    this.document.body.classList.add('app-print-plan');
    this.load();
  }

  ngOnDestroy(): void {
    this.document.body.classList.remove('app-print-plan');
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(false);
    this.paymentPlansApi
      .myPlan()
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((plan) => {
        this.plan.set(plan);
        this.printedAt.set(
          new Date().toLocaleString('el-GR', {
            dateStyle: 'long',
            timeStyle: 'short',
          }),
        );
        this.loading.set(false);
      });
  }

  protected stateOf(installment: InstallmentDto): InstallmentTimelineState {
    return installmentState(installment);
  }

  protected stateLabelOf(installment: InstallmentDto): string {
    return timelineStateLabel(this.stateOf(installment));
  }

  protected dotCls(installment: InstallmentDto): string {
    const state = this.stateOf(installment);
    if (state === 'paid') return 'bg-emerald-500';
    return state === 'overdue' ? 'bg-red-500' : 'bg-slate-300';
  }

  protected amountCls(installment: InstallmentDto): string {
    const state = this.stateOf(installment);
    if (state === 'paid') return 'text-green-700';
    return state === 'overdue' ? 'text-red-600' : 'text-slate-900';
  }

  protected stateTextCls(installment: InstallmentDto): string {
    const state = this.stateOf(installment);
    if (state === 'paid') return 'text-xs font-medium text-green-700';
    return state === 'overdue'
      ? 'text-xs font-medium text-red-600'
      : 'text-xs font-medium text-slate-500';
  }

  protected printSheet(): void {
    window.print();
  }
}
