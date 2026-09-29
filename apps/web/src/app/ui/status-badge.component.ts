import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PaymentStatus } from '@org/shared';
import { TranslatePipe } from '../core/translate.pipe';

const STATUS_STYLES: Record<PaymentStatus, { cls: string; labelKey: string }> = {
  PENDING: { cls: 'bg-amber-100 text-amber-800', labelKey: 'status.pending' },
  PAID: { cls: 'bg-green-100 text-green-800', labelKey: 'status.paid' },
  FAILED: { cls: 'bg-red-100 text-red-700', labelKey: 'status.failed' },
  REFUNDED: { cls: 'bg-slate-100 text-slate-700', labelKey: 'status.refunded' },
};

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <span class="badge" [class]="style().cls">{{ style().labelKey | translate }}</span>
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<PaymentStatus>();

  protected readonly style = computed(
    () => STATUS_STYLES[this.status()] ?? STATUS_STYLES.PENDING,
  );
}
