import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastLink {
  url: string;
  label: string;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  link?: ToastLink;
}

export interface ToastOptions {
  /** Optional link rendered inside the toast (opens in a new tab). */
  link?: ToastLink;
  durationMs?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly toasts = signal<Toast[]>([]);

  show(kind: ToastKind, message: string, options?: ToastOptions): void {
    const id = ++this.nextId;
    this.toasts.update((list) => [
      ...list,
      { id, kind, message, link: options?.link },
    ]);
    const timer = setTimeout(
      () => this.dismiss(id),
      options?.durationMs ?? 4000,
    );
    this.timers.set(id, timer);
  }

  success(message: string, options?: ToastOptions): void {
    this.show('success', message, options);
  }

  error(message: string): void {
    this.show('error', message);
  }

  info(message: string, options?: ToastOptions): void {
    this.show('info', message, { durationMs: 10000, ...options });
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
