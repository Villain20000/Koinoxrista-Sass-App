import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { VoteOutcome, VoteTally } from '@org/shared';
import { TranslatePipe } from '../core/translate.pipe';

export interface TallyRow {
  labelKey: string;
  count: number;
  pct: number;
  cls: string;
}

/** Translation key for a vote outcome. */
export function outcomeLabelKey(
  outcome: VoteOutcome | null | undefined,
): string {
  switch (outcome) {
    case 'PASSED':
      return 'vote.outcome.passed';
    case 'REJECTED':
      return 'vote.outcome.rejected';
    default:
      return 'vote.outcome.inProgress';
  }
}

/** Badge classes for a vote outcome (pure). */
export function outcomeBadgeCls(
  outcome: VoteOutcome | null | undefined,
): string {
  switch (outcome) {
    case 'PASSED':
      return 'bg-green-100 text-green-800';
    case 'REJECTED':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-blue-100 text-blue-800';
  }
}

/** Horizontal YES / NO / ABSTAIN result bars with an outcome badge. */
@Component({
  selector: 'app-vote-tally',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="flex flex-col gap-2">
      @for (row of rows(); track row.labelKey) {
        <div>
          <div class="mb-1 flex justify-between text-xs text-slate-600">
            <span>{{ row.labelKey | translate }}</span>
            <span>
              {{ row.count }} · {{ row.pct }}%
            </span>
          </div>
          <div class="h-2 w-full rounded bg-slate-200">
            <div
              class="h-2 rounded"
              [class]="row.cls"
              [style.width.%]="row.pct"
            ></div>
          </div>
        </div>
      }
      @if (tally().totalMillimes > 0) {
        <p class="text-xs text-slate-500">
          {{ 'vote.tally.millimes' | translate }}: {{ 'vote.yes' | translate }} {{ tally().yesMillimes }}‰ · {{ 'vote.no' | translate }} {{ tally().noMillimes }}‰ /
          {{ tally().totalMillimes }}‰
          @if (!tally().quorumMet) {
            · {{ 'vote.tally.noQuorum' | translate }}
          }
        </p>
      }
      <p>
        <span class="badge" [class]="badgeCls()">
          {{ outcomeText() | translate }}
        </span>
      </p>
    </div>
  `,
})
export class VoteTallyComponent {
  readonly tally = input.required<VoteTally>();

  protected readonly rows = computed<TallyRow[]>(() => {
    const t = this.tally();
    const total = Math.max(1, t.yesCount + t.noCount + t.abstainCount);
    return [
      {
        labelKey: 'vote.yes',
        count: t.yesCount,
        pct: Math.round((t.yesCount / total) * 100),
        cls: 'bg-green-500',
      },
      {
        labelKey: 'vote.no',
        count: t.noCount,
        pct: Math.round((t.noCount / total) * 100),
        cls: 'bg-red-500',
      },
      {
        labelKey: 'vote.abstain',
        count: t.abstainCount,
        pct: Math.round((t.abstainCount / total) * 100),
        cls: 'bg-slate-400',
      },
    ];
  });

  protected readonly outcomeText = () =>
    outcomeLabelKey(this.tally().outcome);

  protected readonly badgeCls = () =>
    outcomeBadgeCls(this.tally().outcome);
}
