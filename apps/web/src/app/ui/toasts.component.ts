import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { TranslatePipe } from '../core/translate.pipe';

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg"
          [class.bg-green-600]="toast.kind === 'success'"
          [class.bg-red-600]="toast.kind === 'error'"
          [class.bg-slate-700]="toast.kind === 'info'"
        >
          <span>
            {{ toast.message }}
            @if (toast.link; as link) {
              <a
                [href]="link.url"
                target="_blank"
                rel="noopener"
                class="font-semibold underline underline-offset-2 hover:opacity-90"
              >
                {{ link.label }}
              </a>
            }
          </span>
          <button
            type="button"
            class="shrink-0 font-bold opacity-80 hover:opacity-100"
            (click)="toastService.dismiss(toast.id)"
            [attr.aria-label]="'common.close' | translate"
          >
            &times;
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastsComponent {
  protected readonly toastService = inject(ToastService);
}
