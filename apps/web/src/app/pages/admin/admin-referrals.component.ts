import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { EMPTY, catchError } from 'rxjs';
import type {
  ReferralCreditDto,
  ReferralInfoDto,
} from '@org/shared/lib/referrals';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import { ReferralsApiService } from '../../core/api/referrals-api.service';
import { ToastService } from '../../ui/toast.service';

@Component({
  selector: 'app-admin-referrals',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">
      Συστάσεις
    </h1>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (loadError() || !info()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης. Δοκιμάστε ξανά.
      </div>
    } @else {
      <div class="grid gap-6 lg:grid-cols-3">
        <!-- Code + link -->
        <section class="card lg:col-span-1">
          <h2 class="card-title mb-3">Ο κωδικός σας</h2>
          <p class="mb-2 font-mono text-2xl font-bold tracking-wider text-slate-900">
            {{ info()!.code }}
          </p>
          <p class="mb-4 text-xs text-slate-500">
            Μοιραστείτε τον σύνδεσμο· η νέα πολυκατοικία παίρνει 3 δωρεάν
            μήνες και εσείς 1 μήνα πίστωση στη συνδρομή σας.
          </p>
          <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs break-all text-slate-700">
            {{ link() }}
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary" (click)="copyLink()">
              Αντιγραφή συνδέσμου
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="rotating()"
              (click)="rotate()"
            >
              {{ rotating() ? 'Αλλαγή…' : 'Νέος κωδικός' }}
            </button>
          </div>
        </section>

        <!-- Credits -->
        <section class="card overflow-x-auto p-0 lg:col-span-2">
          <h2 class="card-title border-b border-slate-100 p-4">Πιστώσεις</h2>
          <table class="data-table">
            <thead>
              <tr>
                <th>Κωδικός</th>
                <th>Λόγος</th>
                <th>Μήνες</th>
                <th>Κατάσταση</th>
                <th>Περίοδος χρήσης</th>
                <th>Δημιουργία</th>
              </tr>
            </thead>
            <tbody>
              @for (credit of info()!.credits; track credit.id) {
                <tr>
                  <td class="font-mono">{{ credit.code }}</td>
                  <td>{{ reasonLabel(credit) }}</td>
                  <td>{{ credit.months }}</td>
                  <td>
                    @if (credit.usedAt) {
                      <span
                        class="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                      >
                        Χρησιμοποιημένη
                      </span>
                    } @else {
                      <span
                        class="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                      >
                        Διαθέσιμη
                      </span>
                    }
                  </td>
                  <td>{{ credit.usedPeriod ?? '—' }}</td>
                  <td>{{ shortDate(credit.createdAt) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="py-8 text-center text-slate-500">
                    Δεν υπάρχουν πιστώσεις ακόμα.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      </div>
    }
  `,
})
export class AdminReferralsPage implements OnInit {
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly referralsApi = inject(ReferralsApiService);
  private readonly toast = inject(ToastService);

  protected readonly info = signal<ReferralInfoDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly rotating = signal(false);

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reload();
      });
  }

  protected link(): string {
    const current = this.info();
    return current ? this.referralsApi.referralLink(current) : '';
  }

  protected copyLink(): void {
    const url = this.link();
    if (!url) return;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => this.toast.success('Ο σύνδεσμος αντιγράφηκε.'))
      .catch(() => this.toast.error('Η αντιγραφή απέτυχε.'));
  }

  protected rotate(): void {
    if (!this.buildingId || this.rotating()) return;
    this.rotating.set(true);
    this.referralsApi
      .rotateCode(this.buildingId)
      .pipe(catchError(() => EMPTY))
      .subscribe({
        next: ({ code }) => {
          this.rotating.set(false);
          this.toast.success(`Νέος κωδικός: ${code}`);
          this.reload();
        },
        error: () => {
          this.rotating.set(false);
          this.toast.error('Η αλλαγή κωδικού απέτυχε.');
        },
      });
  }

  protected reasonLabel(credit: ReferralCreditDto): string {
    return credit.reason === 'REFERRED'
      ? 'Σύσταση νέας πολυκατοικίας'
      : 'Παραπομπή άλλης πολυκατοικίας';
  }

  protected shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString('el-GR');
  }

  private reload(): void {
    if (!this.buildingId) return;
    this.loadError.set(false);
    this.referralsApi
      .info(this.buildingId)
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((info) => {
        this.info.set(info);
        this.loading.set(false);
      });
  }
}
