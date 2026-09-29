import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  signal,
} from '@angular/core';
import { TranslatePipe } from '../core/translate.pipe';

/** Pure payment note for IRIS transfers, e.g. "IRIS OC-123456789". */
export function buildIrisNote(orderCode: string): string {
  return `IRIS ${orderCode}`;
}

/** Scannable QR code of a checkout URL; the qrcode lib is lazy-loaded. */
@Component({
  selector: 'app-qr-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (dataUrl(); as url) {
      <img
        [src]="url"
        [alt]="'qrcode.alt' | translate"
        [width]="size()"
        [height]="size()"
        class="rounded-lg border border-slate-200 bg-white"
      />
    } @else {
      <span class="text-sm text-slate-500">{{ 'qrcode.unavailable' | translate }}</span>
    }
  `,
})
export class QrCodeComponent {
  /** Payload to encode (empty/null renders the fallback text). */
  readonly value = input<string | null>(null);
  readonly size = input(160);

  protected readonly dataUrl = signal<string | null>(null);

  private seq = 0;

  constructor() {
    effect(() => {
      void this.render(this.value());
    });
  }

  private async render(value: string | null): Promise<void> {
    const id = ++this.seq;
    if (!value) {
      this.dataUrl.set(null);
      return;
    }
    try {
      const { toDataURL } = await import('qrcode');
      const url = await toDataURL(value, { width: this.size(), margin: 1 });
      if (id !== this.seq) return;
      this.dataUrl.set(url);
    } catch {
      if (id !== this.seq) return;
      this.dataUrl.set(null);
    }
  }
}
