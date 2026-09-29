import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { barHeight, maxOfSeries, truncateLabel } from './chart-utils';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';

interface BarColumn {
  x: number;
  width: number;
  overlayWidth: number;
  y: number;
  height: number;
  overlayY: number;
  overlayHeight: number;
  label: string;
  valueText: string;
  overlayText: string;
}

const VIEW_W = 640;
const VIEW_H = 260;
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 30;

/** Hand-rolled SVG bar chart with an optional overlaid second series. */
@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="flex flex-wrap items-center gap-4 text-xs text-slate-600">
      <span class="flex items-center gap-1.5">
        <span class="inline-block h-2.5 w-2.5 rounded-sm bg-[#93c5fd]" aria-hidden="true"></span>
        {{ primaryLabel() }}
      </span>
      @if (overlayValues(); as overlay) {
        <span class="flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 rounded-sm bg-[#16a34a]" aria-hidden="true"></span>
          {{ secondaryLabel() }}
        </span>
      }
    </div>

    @if (columns().length === 0) {
      <p class="py-10 text-center text-sm text-slate-400">{{ 'charts.noData' | translate }}</p>
    } @else {
      <svg
        [attr.viewBox]="'0 0 ' + viewW + ' ' + viewH"
        class="mt-2 w-full"
        role="img"
        [attr.aria-label]="ariaLabel()"
        preserveAspectRatio="xMidYMid meet"
      >
        <line
          [attr.x1]="padX"
          [attr.y1]="baselineY"
          [attr.x2]="viewW - padX"
          [attr.y2]="baselineY"
          stroke="#cbd5e1"
          stroke-width="1"
        />
        @for (bar of columns(); track bar.label + $index) {
          <g>
            <title>{{ bar.valueText }}</title>
            <rect
              [attr.x]="bar.x"
              [attr.y]="bar.y"
              [attr.width]="bar.width"
              [attr.height]="bar.height"
              rx="3"
              fill="#93c5fd"
            >
            </rect>
            @if (overlayValues()) {
              <rect
                [attr.x]="bar.x + (bar.width - bar.overlayWidth) / 2"
                [attr.y]="bar.overlayY"
                [attr.width]="bar.overlayWidth"
                [attr.height]="bar.overlayHeight"
                rx="2"
                fill="#16a34a"
              >
                <title>{{ bar.overlayText }}</title>
              </rect>
            }
            <text
              [attr.x]="bar.x + bar.width / 2"
              [attr.y]="baselineY + 18"
              text-anchor="middle"
              font-size="11"
              fill="#64748b"
            >{{ bar.label }}</text>
          </g>
        }
      </svg>
    }
  `,
})
export class BarChartComponent {
  readonly values = input.required<number[]>();
  readonly labels = input.required<string[]>();
  readonly overlayValues = input<number[] | null>(null);
  readonly valueFormatter = input<(n: number) => string>((n) => String(n));
  readonly primaryLabel = input('Credits');
  readonly secondaryLabel = input('Collections');

  private readonly i18n = inject(I18nService);

  protected readonly viewW = VIEW_W;
  protected readonly viewH = VIEW_H;
  protected readonly padX = PAD_X;
  protected readonly baselineY = VIEW_H - PAD_BOTTOM;
  private readonly plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;

  private readonly maxValue = computed(() =>
    maxOfSeries([this.values(), this.overlayValues()]),
  );

  protected readonly columns = computed<BarColumn[]>(() => {
    const values = this.values();
    const labels = this.labels();
    const overlay = this.overlayValues();
    const count = values.length;
    if (count === 0) return [];

    const max = this.maxValue();
    const slot = (VIEW_W - 2 * PAD_X) / count;
    const width = Math.min(Math.max(6, slot * 0.6), 56);
    const overlayWidth = Math.round(width * 0.55);
    const format = this.valueFormatter();

    return values.map((value, i) => {
      const height = barHeight(value, max, this.plotH);
      const overlayHeight =
        overlay ? barHeight(overlay[i] ?? 0, max, this.plotH) : 0;
      const x = PAD_X + slot * i + (slot - width) / 2;
      return {
        x,
        width,
        overlayWidth,
        y: this.baselineY - height,
        height,
        overlayY: this.baselineY - overlayHeight,
        overlayHeight,
        label: truncateLabel(labels[i] ?? '', 7),
        valueText: `${labels[i] ?? ''} · ${this.primaryLabel()}: ${format(value)}`,
        overlayText: `${labels[i] ?? ''} · ${this.secondaryLabel()}: ${format(overlay?.[i] ?? 0)}`,
      };
    });
  });

  protected readonly ariaLabel = computed(() => {
    const bars = this.columns();
    if (bars.length === 0) {
      return this.i18n.translate('charts.emptyAria');
    }
    const withOverlay = !!this.overlayValues();
    const parts = bars.map((bar) =>
      withOverlay ? `${bar.valueText}, ${bar.overlayText}` : bar.valueText,
    );
    return `${this.i18n.translate('charts.barChart')}. ${parts.join('; ')}.`;
  });
}
