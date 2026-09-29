import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TourService } from '../core/tour.service';
import { TranslatePipe } from '../core/translate.pipe';

/** One tour step; `selector` spotlights an element (omit for a centered card). */
export interface HelpTourStep {
  title: string;
  body: string;
  selector?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 288; // w-72
const CARD_GAP = 12;
const SPOTLIGHT_PAD = 6;

/**
 * Hand-rolled spotlight tour (no deps): fixed overlay with a cut-out over the
 * targeted element plus a positioned card. Completion is persisted per
 * tour-id in localStorage via TourService, so each tour plays once.
 */
@Component({
  selector: 'app-help-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-[70]" role="dialog" aria-live="polite">
        @if (rect(); as r) {
          <div
            class="absolute rounded-xl ring-4 ring-sky-400"
            [style.top.px]="r.top - pad"
            [style.left.px]="r.left - pad"
            [style.width.px]="r.width + pad * 2"
            [style.height.px]="r.height + pad * 2"
            [style.box-shadow]="'0 0 0 9999px rgba(15, 23, 42, 0.55)'"
          ></div>
        } @else {
          <div class="absolute inset-0 bg-slate-900/55"></div>
        }

        <div
          class="card absolute w-72 max-w-[calc(100vw-2rem)] shadow-xl"
          [style.top.px]="cardPos().top"
          [style.left.px]="cardPos().left"
        >
          <h3 class="card-title">{{ step().title }}</h3>
          <p class="text-sm text-slate-600">{{ step().body }}</p>
          <div class="mt-4 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1" aria-hidden="true">
              @for (dot of dots(); track $index) {
                <span
                  class="h-2 w-2 rounded-full"
                  [class.bg-sky-500]="dot"
                  [class.bg-slate-300]="!dot"
                ></span>
              }
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-secondary !px-2 !py-1 text-xs"
                (click)="skip()"
              >
                {{ 'help.skip' | translate }}
              </button>
              <button
                type="button"
                class="btn btn-primary !px-2 !py-1 text-xs"
                (click)="next()"
              >
                {{ last() ? ('help.done' | translate) : ('help.next' | translate) }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class HelpTourComponent implements OnInit, OnDestroy {
  readonly tourId = input.required<string>();
  readonly steps = input.required<HelpTourStep[]>();
  /** Parent kill-switch (lets pages gate the mount themselves). */
  readonly open = input<boolean>(true);
  readonly closed = output<void>();

  private readonly tour = inject(TourService);

  protected readonly pad = SPOTLIGHT_PAD;
  protected readonly index = signal(0);
  protected readonly rect = signal<Rect | null>(null);

  protected readonly step = computed(
    () => this.steps()[Math.min(this.index(), this.steps().length - 1)],
  );
  protected readonly last = computed(
    () => this.index() >= this.steps().length - 1,
  );
  protected readonly dots = computed(() =>
    this.steps().map((_, i) => i === this.index()),
  );

  protected readonly cardPos = computed(() => {
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
    const r = this.rect();
    if (!r) {
      // No target: center the card.
      return {
        top: Math.max(16, Math.round((viewportH - 200) / 2)),
        left: Math.max(16, Math.round((viewportW - CARD_WIDTH) / 2)),
      };
    }
    // Prefer below the target, fall back above; clamp into the viewport.
    const belowTop = r.top + r.height + CARD_GAP;
    const cardHeightEstimate = 190;
    const top =
      belowTop + cardHeightEstimate < viewportH
        ? belowTop
        : Math.max(16, r.top - cardHeightEstimate - CARD_GAP);
    const left = Math.min(
      Math.max(16, r.left),
      Math.max(16, viewportW - CARD_WIDTH - 16),
    );
    return { top, left };
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        this.place();
      }
    });
  }

  ngOnInit(): void {
    if (!this.tour.launch(this.tourId()) || this.steps().length === 0) {
      this.closed.emit();
      return;
    }
    window.addEventListener('resize', this.onResize);
    this.place();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
  }

  protected next(): void {
    if (this.last()) {
      this.finish();
      return;
    }
    this.index.update((i) => i + 1);
    this.place();
  }

  protected skip(): void {
    this.finish();
  }

  private finish(): void {
    this.tour.markDone(this.tourId());
    this.closed.emit();
  }

  private place(): void {
    const selector = this.step()?.selector;
    const el = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (!el) {
      this.rect.set(null);
      return;
    }
    const r = el.getBoundingClientRect();
    this.rect.set({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    });
  }

  private readonly onResize = (): void => this.place();
}
