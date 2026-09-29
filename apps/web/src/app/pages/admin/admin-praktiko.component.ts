import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { EMPTY, catchError } from 'rxjs';
import type { PraktikoDto, VoteOutcome } from '@org/shared';
import { AssemblyApiService } from '../../core/api/assembly-api.service';
import { thresholdLabel } from '../../core/api/votes-api.service';

/** Greek label for a recorded decision outcome (pure). */
export function outcomeLabel(outcome: VoteOutcome): string {
  switch (outcome) {
    case 'PASSED':
      return 'Εγκρίθηκε';
    case 'REJECTED':
      return 'Απορρίφθηκε';
    default:
      return 'Εκκρεμεί';
  }
}

/** Badge style for a decision outcome (pure). */
export function outcomeBadge(outcome: VoteOutcome): { cls: string } {
  switch (outcome) {
    case 'PASSED':
      return { cls: 'bg-green-100 text-green-800' };
    case 'REJECTED':
      return { cls: 'bg-red-100 text-red-800' };
    default:
      return { cls: 'bg-amber-100 text-amber-800' };
  }
}

/** Long-form el-GR rendering of the assembly's date window (pure). */
export function windowLabel(opensAt: string, closesAt: string): string {
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleString('el-GR', { dateStyle: 'long' });
  return `${fmt(opensAt)} έως ${fmt(closesAt)}`;
}

@Component({
  selector: 'app-admin-praktiko',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @media print {
      ::ng-deep body.app-print-praktiko app-layout header,
      ::ng-deep body.app-print-praktiko app-layout aside {
        display: none !important;
      }
      ::ng-deep body.app-print-praktiko app-layout main {
        margin-left: 0 !important;
        padding: 0 !important;
      }
    }
  `,
  template: `
    <div class="mx-auto max-w-3xl">
      <div class="print:hidden mb-6 flex items-center justify-between">
        <h1 class="text-xl font-bold text-slate-900">Πρακτικό συνέλευσης</h1>
        <button type="button" class="btn btn-primary" (click)="print()">
          Εκτύπωση
        </button>
      </div>

      @if (loading()) {
        <div class="card text-sm text-slate-500">Φόρτωση…</div>
      } @else if (error()) {
        <div class="card border-red-200 bg-red-50 text-sm text-red-700">
          Αποτυχία φόρτωσης πρακτικού.
        </div>
      } @else if (praktiko(); as p) {
        <article class="card p-8">
          <header class="mb-6 border-b border-slate-200 pb-4 text-center">
            <p class="text-xs uppercase tracking-widest text-slate-500">
              Κοινότητα ιδιοκτητών
            </p>
            <h2 class="mt-1 text-lg font-bold text-slate-900">
              {{ p.building.name }}
            </h2>
            <p class="text-sm text-slate-600">
              {{ p.building.address }}, {{ p.building.city }}
            </p>
            <h3 class="mt-4 font-semibold uppercase tracking-wide text-slate-900">
              Πρακτικό Γενικής Συνέλευσης
            </h3>
            <p class="mt-1 text-sm text-slate-600">{{ p.vote.topic }}</p>
          </header>

          <section class="mb-6">
            <h4 class="card-title">Συνεδρίαση</h4>
            <dl class="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt class="text-slate-500">Θέμα</dt>
                <dd class="font-medium text-slate-900">{{ p.vote.topic }}</dd>
              </div>
              <div>
                <dt class="text-slate-500">Πλειοψηφία</dt>
                <dd class="font-medium text-slate-900">
                  {{ thresholdLabel(p.vote.thresholdType) }}
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="text-slate-500">Διάστημα ψηφοφορίας</dt>
                <dd class="font-medium text-slate-900">
                  {{ windowLabel(p.vote.opensAt, p.vote.closesAt) }}
                </dd>
              </div>
            </dl>
          </section>

          <section class="mb-6">
            <h4 class="card-title">Παρουσίες & κορμός</h4>
            <table class="data-table">
              <tbody>
                <tr>
                  <td>Διαμερίσματα σε συνεδρίαση</td>
                  <td class="text-right font-medium">
                    {{ p.attendance.unitsPresent }} / {{ p.attendance.unitsTotal }}
                  </td>
                </tr>
                <tr>
                  <td>Χιλιοστά σε συνεδρίαση</td>
                  <td class="text-right font-medium">
                    {{ p.attendance.millimesPresent }} /
                    {{ p.attendance.totalMillimes }}
                    ({{ p.attendance.presentPermille }}‰)
                  </td>
                </tr>
                <tr>
                  <td>Κορμός</td>
                  <td class="text-right font-medium">
                    {{ p.attendance.quorumMet ? 'Επιτεύχθηκε' : 'Δεν επιτεύχθηκε' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="mb-6">
            <h4 class="card-title">Ημερήσια διάταξη</h4>
            <ol class="list-decimal space-y-1 pl-5 text-sm">
              @for (item of p.agenda; track item.id) {
                <li>
                  <span class="font-medium text-slate-900">{{ item.title }}</span>
                  @if (item.body) {
                    <p class="text-slate-600">{{ item.body }}</p>
                  }
                </li>
              } @empty {
                <li class="text-slate-500">Καμία καταγραμμένη θεματική ενότητα.</li>
              }
            </ol>
          </section>

          <section class="mb-6">
            <h4 class="card-title">Αποφάσεις</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Θέμα</th>
                  <th class="text-right">Υπέρ</th>
                  <th class="text-right">Κατά</th>
                  <th class="text-right">Αποχή</th>
                  <th>Απόφαση</th>
                </tr>
              </thead>
              <tbody>
                @for (decision of p.decisions; track decision.agendaItemId) {
                  <tr>
                    <td>{{ decision.title }}</td>
                    <td class="text-right">{{ decision.yesCount }}</td>
                    <td class="text-right">{{ decision.noCount }}</td>
                    <td class="text-right">{{ decision.abstainCount }}</td>
                    <td>
                      <span class="badge" [class]="outcomeBadge(decision.outcome).cls">
                        {{ outcomeLabel(decision.outcome) }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            @if (!p.vote.closed) {
              <p class="mt-2 text-xs text-amber-700">
                Η ψηφοφορία είναι ακόμη ανοιχτή — το πρακτικό θα οριστικοποιηθεί
                με το κλείσιμό της.
              </p>
            }
          </section>

          <section class="mb-4 grid grid-cols-2 gap-8 pt-10">
            <div class="border-t border-slate-400 pt-1 text-center text-xs text-slate-500">
              Ο Διαχειριστής
            </div>
            <div class="border-t border-slate-400 pt-1 text-center text-xs text-slate-500">
              Αναπληρωτής Διαχειριστής
            </div>
          </section>

          <p class="text-xs text-slate-400">
            Εκδόθηκε στις {{ issuedAt(p.generatedAt) }}
          </p>
        </article>
      }
    </div>
  `,
})
export class AdminPraktikoPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(AssemblyApiService);
  private readonly document = inject(DOCUMENT);

  protected readonly praktiko = signal<PraktikoDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly outcomeLabel = outcomeLabel;
  protected readonly outcomeBadge = outcomeBadge;
  protected readonly thresholdLabel = thresholdLabel;

  ngOnInit(): void {
    this.document.body.classList.add('app-print-praktiko');
    const voteId =
      this.route.snapshot.paramMap.get('voteId') ??
      this.route.snapshot.paramMap.get('id');
    if (!voteId) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }
    this.api
      .praktiko(voteId)
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((praktiko) => {
        this.praktiko.set(praktiko);
        this.loading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.document.body.classList.remove('app-print-praktiko');
  }

  protected windowLabel(opensAt: string, closesAt: string): string {
    return windowLabel(opensAt, closesAt);
  }

  protected issuedAt(generatedAt: string): string {
    return new Date(generatedAt).toLocaleString('el-GR', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
  }

  protected print(): void {
    window.print();
  }
}
