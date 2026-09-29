import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, catchError, of } from 'rxjs';
import type { FeaturedSlotDto } from '@org/shared';
import { BuildingsApiService } from '../../core/api/buildings-api.service';
import {
  MarketplaceApiService,
} from '../../core/api/marketplace-api.service';
import {
  ProviderDirectoryItem,
  ProvidersApiService,
} from '../../core/api/providers-api.service';
import { ToastService } from '../../ui/toast.service';
import { formatEuros } from '../../ui/format';

/** Directory row enriched by the API with an optional active featured slot. */
type DirectoryItem = ProviderDirectoryItem & { featuredUntil?: string | null };

@Component({
  selector: 'app-admin-directory',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-6 text-xl font-bold text-slate-900">Τεχνικοί</h1>

    <form
      [formGroup]="filters"
      (ngSubmit)="applyFilters()"
      class="card mb-6 grid gap-4 sm:grid-cols-4"
    >
      <div class="sm:col-span-2">
        <label class="label" for="q">Αναζήτηση</label>
        <input id="q" type="text" class="input" formControlName="q" placeholder="Αναζήτηση…" />
      </div>
      <div>
        <label class="label" for="trade">Ειδικότητα</label>
        <input id="trade" type="text" class="input" formControlName="trade" />
      </div>
      <div>
        <label class="label" for="city">Πόλη</label>
        <input id="city" type="text" class="input" formControlName="city" />
      </div>
      <div>
        <label class="label" for="minRating">Ελάχιστη αξιολόγηση</label>
        <select id="minRating" class="input" formControlName="minRating">
          <option value="">Οποιαδήποτε</option>
          @for (r of ratingOptions; track r) {
            <option [value]="r">{{ r }}+ αστέρια</option>
          }
        </select>
      </div>
      <div class="flex items-end justify-end sm:col-span-3">
        <button type="submit" class="btn btn-primary">Αναζήτηση</button>
      </div>
    </form>

    @if (loading()) {
      <div class="grid gap-4 sm:grid-cols-2">
        @for (s of skeletons; track s) {
          <div class="card animate-pulse">
            <div class="h-5 w-2/3 rounded bg-slate-200"></div>
            <div class="mt-3 h-4 w-1/3 rounded bg-slate-100"></div>
            <div class="mt-4 h-3 w-full rounded bg-slate-100"></div>
            <div class="mt-2 h-3 w-5/6 rounded bg-slate-100"></div>
            <div class="mt-5 h-8 w-40 rounded bg-slate-200"></div>
          </div>
        }
      </div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης τεχνικών. Δοκιμάστε ξανά.
      </div>
    } @else {
      @if (hasFeatured()) {
        <p class="mb-4 flex items-center gap-1 text-xs text-slate-500">
          <span aria-hidden="true">⭐</span>
          Οι προτεινόμενοι τεχνικοί εμφανίζονται πρώτοι στη λίστα.
        </p>
      }

      <div class="grid gap-4 sm:grid-cols-2">
        @for (p of results(); track p.userId) {
          <article class="card flex flex-col gap-3">
            <div>
              <div class="flex items-center justify-between gap-2">
                <h2 class="font-semibold text-slate-900">{{ p.firstName }} {{ p.lastName }}</h2>
                @if (p.featuredUntil) {
                  <span
                    class="badge inline-flex shrink-0 items-center gap-1 bg-amber-100 text-amber-800"
                    title="Ενεργή προβολή έως {{ shortDate(p.featuredUntil) }}"
                  >
                    <span aria-hidden="true">⭐</span> Προτεινόμενος
                  </span>
                }
              </div>
              <p class="text-sm text-slate-500">{{ p.trade || '—' }}</p>
            </div>

            @if ((p.avgRating ?? p.rating) !== null) {
              <div class="flex items-center gap-2 text-sm">
                <span class="text-amber-500" aria-hidden="true">
                  @for (star of starValues; track star) {
                    <span>{{ star <= filledStars(p) ? '★' : '☆' }}</span>
                  }
                </span>
                <span class="font-medium text-slate-700">{{ ratingLabel(p) }}</span>
              </div>
            } @else {
              <p class="text-sm text-slate-400">Νέος χωρίς κριτικές</p>
            }

            @if (p.certs.length > 0) {
              <div class="flex flex-wrap gap-1">
                @for (cert of p.certs; track cert) {
                  <span class="badge bg-slate-200 text-slate-700">{{ cert }}</span>
                }
              </div>
            }

            @if (p.city) {
              <p class="text-xs text-slate-500">Πόλη: {{ p.city }}</p>
            }

            @if (p.bio) {
              <p class="line-clamp-2 text-sm text-slate-600">{{ p.bio }}</p>
            }

            @if (p.hourlyRateCents !== null && p.hourlyRateCents !== undefined) {
              <p class="text-sm font-medium text-slate-700">
                Ωρομίσθιο: {{ euros(p.hourlyRateCents) }}
              </p>
            }

            <p class="text-xs text-slate-500">
              Ολοκληρωμένες εργασίες: {{ p.completedJobs }}
            </p>

            <button
              type="button"
              class="btn btn-primary mt-auto self-start !px-3 !py-1 text-xs"
              (click)="newJobWith(p.userId)"
            >
              Νέα εργασία με αυτόν τον τεχνικό
            </button>
          </article>
        } @empty {
          <div class="card text-sm text-slate-500 sm:col-span-2">
            Δεν βρέθηκαν τεχνικοί.
          </div>
        }
      </div>
    }

    <!-- Featured placements admin -->
    <section class="card mt-8">
      <h2 class="card-title mb-1">Προτεινόμενες καταχωρίσεις κτιρίου</h2>
      <p class="mb-4 text-xs text-slate-500">
        Οι προτεινόμενοι τεχνικοί εμφανίζονται πρώτοι στον κατάλογο του κτιρίου σας,
        για το διάστημα που ορίζετε.
      </p>

      <form [formGroup]="slotForm" (ngSubmit)="createSlot()" class="mb-6 grid gap-3 sm:grid-cols-5">
        <div class="sm:col-span-2">
          <label class="label" for="providerId">Τεχνικός</label>
          <select id="providerId" class="input" formControlName="providerId">
            <option value="">— Επιλέξτε —</option>
            @for (p of results(); track p.userId) {
              <option [value]="p.userId">
                {{ p.firstName }} {{ p.lastName }}{{ p.trade ? ' · ' + p.trade : '' }}
              </option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="slotTrade">Ειδικότητα (προαιρετικό)</label>
          <input id="slotTrade" type="text" class="input" formControlName="trade" />
        </div>
        <div>
          <label class="label" for="startsAt">Από</label>
          <input id="startsAt" type="datetime-local" class="input" formControlName="startsAt" />
        </div>
        <div>
          <label class="label" for="endsAt">Έως</label>
          <input id="endsAt" type="datetime-local" class="input" formControlName="endsAt" />
        </div>
        <div class="sm:col-span-5">
          <button
            type="submit"
            class="btn btn-primary"
            [disabled]="creatingSlot()"
          >
            Προσθήκη προβολής
          </button>
          @if (slotFormError()) {
            <p class="field-error mt-2">{{ slotFormError() }}</p>
          }
        </div>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>Τεχνικός</th>
            <th>Ειδικότητα</th>
            <th>Από</th>
            <th>Έως</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (slot of slots(); track slot.id) {
            <tr>
              <td class="font-medium">{{ slot.providerName || slot.providerId }}</td>
              <td>{{ slot.trade || '—' }}</td>
              <td>{{ shortDate(slot.startsAt) }}</td>
              <td>{{ shortDate(slot.endsAt) }}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-secondary !px-2 !py-1 text-xs"
                  [disabled]="deletingId() === slot.id"
                  (click)="deleteSlot(slot)"
                >
                  Διαγραφή
                </button>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="5" class="py-6 text-center text-slate-500">
                Δεν υπάρχουν προγραμματισμένες προβολές.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class AdminDirectoryPage implements OnInit {
  private readonly providersApi = inject(ProvidersApiService);
  private readonly marketplaceApi = inject(MarketplaceApiService);
  private readonly buildingsApi = inject(BuildingsApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly euros = formatEuros;

  protected readonly results = signal<DirectoryItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly slots = signal<FeaturedSlotDto[]>([]);
  protected readonly creatingSlot = signal(false);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly slotFormError = signal<string | null>(null);

  protected readonly ratingOptions = [1, 2, 3, 4, 5];
  protected readonly starValues = [1, 2, 3, 4, 5];
  protected readonly skeletons = [0, 1, 2, 3];

  protected readonly filters = this.fb.nonNullable.group({
    q: [''],
    trade: [''],
    city: [''],
    minRating: [''],
  });

  protected readonly slotForm = this.fb.nonNullable.group({
    providerId: ['', Validators.required],
    trade: [''],
    startsAt: ['', Validators.required],
    endsAt: ['', Validators.required],
  });

  private buildingId: string | null = null;

  ngOnInit(): void {
    this.applyFilters();
    this.buildingsApi
      .mine()
      .pipe(catchError(() => EMPTY))
      .subscribe((building) => {
        this.buildingId = building.id;
        this.reloadSlots();
      });
  }

  /** Whether any listed provider currently has an active featured slot. */
  protected hasFeatured(): boolean {
    return this.results().some((p) => !!p.featuredUntil);
  }

  /** `DD/MM/YYYY` short label for ISO datetimes. */
  protected shortDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('el-GR');
  }

  /** Effective rating shown on the card (pure). */
  protected displayRating(p: DirectoryItem): number | null {
    return p.avgRating ?? p.rating;
  }

  protected filledStars(p: DirectoryItem): number {
    const value = this.displayRating(p);
    return value === null ? 0 : Math.round(value);
  }

  protected ratingLabel(p: DirectoryItem): string {
    const value = this.displayRating(p);
    return value === null ? 'Νέος χωρίς κριτικές' : `${value.toFixed(1)} / 5`;
  }

  protected applyFilters(): void {
    const { q, trade, city, minRating } = this.filters.getRawValue();
    const min = Number(minRating);
    this.loading.set(true);
    this.error.set(false);
    this.providersApi
      .search({
        q: q.trim() || undefined,
        trade: trade.trim() || undefined,
        city: city.trim() || undefined,
        minRating: min > 0 ? min : undefined,
      })
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((items) => {
        this.results.set(items as DirectoryItem[]);
        this.loading.set(false);
      });
  }

  protected createSlot(): void {
    this.slotFormError.set(null);
    if (!this.buildingId || this.creatingSlot()) return;
    if (this.slotForm.invalid) {
      this.slotFormError.set('Συμπληρώστε τεχνικό και ημερομηνίες.');
      return;
    }

    const { providerId, trade, startsAt, endsAt } = this.slotForm.getRawValue();
    const startIso = toIso(startsAt);
    const endIso = toIso(endsAt);
    if (!startIso || !endIso) {
      this.slotFormError.set('Μη έγκυρες ημερομηνίες.');
      return;
    }
    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      this.slotFormError.set('Το «Έως» πρέπει να είναι μετά το «Από».');
      return;
    }

    this.creatingSlot.set(true);
    this.marketplaceApi
      .createFeaturedSlot(this.buildingId, {
        providerId,
        trade: trade.trim() || null,
        startsAt: startIso,
        endsAt: endIso,
      })
      .pipe(
        catchError(() => {
          this.toast.error(
            'Η δημιουργία απέτυχε — ελέγξτε για επικαλυπτόμενη προβολή.',
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.toast.success('Η προβολή προστέθηκε.');
        this.creatingSlot.set(false);
        this.slotForm.reset({ providerId: '', trade: '', startsAt: '', endsAt: '' });
        this.reloadSlots();
        this.applyFilters();
      });
  }

  protected deleteSlot(slot: FeaturedSlotDto): void {
    if (!this.buildingId || this.deletingId()) return;
    this.deletingId.set(slot.id);
    this.marketplaceApi
      .deleteFeaturedSlot(this.buildingId, slot.id)
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.deletingId.set(null);
        this.toast.success('Η προβολή διαγράφηκε.');
        this.reloadSlots();
        this.applyFilters();
      });
  }

  protected newJobWith(userId: string): void {
    void this.router.navigate(['/admin/jobs'], {
      queryParams: { provider: userId },
    });
  }

  private reloadSlots(): void {
    if (!this.buildingId) return;
    this.marketplaceApi
      .featuredSlots(this.buildingId)
      .pipe(catchError(() => of([])))
      .subscribe((slots) => this.slots.set(slots));
  }
}

/** datetime-local value → ISO string; null when unparseable. */
function toIso(localValue: string): string | null {
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
