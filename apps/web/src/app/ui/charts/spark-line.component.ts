import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../../core/translate.pipe';

const VIEW_W = 120;
const VIEW_H = 36;
const PAD = 3;

/** Minimal polyline sparkline for embedding next to KPI numbers. */
@Component({
  selector: 'app-spark-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + viewW + ' ' + viewH"
      class="h-9 w-full text-blue-500"
      role="img"
      [attr.aria-label]="ariaLabel() || ('charts.trend' | translate)"
      preserveAspectRatio="none"
    >
      @if (points()) {
        <polyline
          [attr.points]="points()"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      }
    </svg>
  `,
})
export class SparkLineComponent {
  readonly values = input.required<number[]>();
  readonly ariaLabel = input('');

  protected readonly viewW = VIEW_W;
  protected readonly viewH = VIEW_H;

  protected readonly points = computed<string>(() => {
    const values = this.values();
    if (values.length < 2) return '';
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    const usableW = VIEW_W - 2 * PAD;
    const usableH = VIEW_H - 2 * PAD;
    return values
      .map((value, i) => {
        const x = PAD + (i / (values.length - 1)) * usableW;
        const y = PAD + usableH - ((value - min) / span) * usableH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
}
