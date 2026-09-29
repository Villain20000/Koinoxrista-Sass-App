import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '../core/translate.pipe';

/** Reusable confirmation dialog (overlay + card). */
@Component({
  selector: 'app-confirm-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        class="absolute inset-0 cursor-default bg-slate-900/40"
        (click)="cancelled.emit()"
        [attr.aria-label]="'common.close' | translate"
      ></button>
      <div class="card relative z-10 w-full max-w-md">
        <h2 class="mb-2 text-base font-semibold text-slate-900">{{ title() }}</h2>
        <p class="mb-4 text-sm text-slate-600">{{ message() }}</p>
        @if (body(); as content) {
          <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {{ content }}
          </div>
        }
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-secondary" (click)="cancelled.emit()">
            {{ 'common.cancel' | translate }}
          </button>
          <button
            type="button"
            class="btn"
            [class.btn-danger]="danger()"
            [class.btn-primary]="!danger()"
            (click)="confirmed.emit()"
          >
            {{ confirmLabel() || ('common.confirm' | translate) }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmModalComponent {
  readonly title = input.required<string>();
  readonly message = input<string>('');
  /** Optional preformatted block shown between the message and the actions. */
  readonly body = input<string | null>(null);
  readonly confirmLabel = input<string>('');
  readonly danger = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
