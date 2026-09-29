import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { EMPTY, catchError } from 'rxjs';
import { AUDIT_ACTIONS, AuditLogDto, AuditQueryDto } from '@org/shared';
import { AuditApiService } from '../../core/api/audit-api.service';
import { ToastService } from '../../ui/toast.service';
import { shortRef } from '../../ui/format';

/** Greek label per audited action (falls back to the raw action key). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'expense.created': 'Δημιουργία δαπάνης',
  'invoice.run': 'Εκτέλεση κατανεμώσεων',
  'payment.checkout': 'Έναρξη πληρωμής',
  'payment.webhook': 'Επιβεβαίωση πληρωμής (webhook)',
  'vote.created': 'Δημιουργία ψηφοφορίας',
  'vote.ballot': 'Κατάθεση ψήφου',
  'vote.closed': 'Κλείσιμο ψηφοφορίας',
  'subscription.changed': 'Αλλαγή συνδρομής',
  'platform_invoice.issued': 'Έκδοση τιμολογίου πλατφόρμας',
  'gdpr.deleted': 'Ανωνυμοποίηση GDPR',
  'apikey.created': 'Δημιουργία κλειδιού API',
  'apikey.revoked': 'Ανάκληση κλειδιού API',
};

const ROLE_BADGES: Record<string, { cls: string; label: string }> = {
  ADMIN: { cls: 'bg-indigo-100 text-indigo-800', label: 'Διαχειριστής' },
  RESIDENT: { cls: 'bg-green-100 text-green-800', label: 'Διαμένων' },
  PROVIDER: { cls: 'bg-amber-100 text-amber-800', label: 'Προμηθευτής' },
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Formats an ISO timestamp as a Greek date-time string (pure). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('el-GR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Pretty-prints audit metadata JSON and truncates for table display (pure). */
export function prettyMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return '—';
  const json = JSON.stringify(metadata);
  return json.length <= 120 ? json : `${json.slice(0, 120)}…`;
}

/** Local date input value (YYYY-MM-DD) to ISO bound; null when empty (pure). */
export function dateInputToIso(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const time = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  return new Date(`${value}${time}`).toISOString();
}

@Component({
  selector: 'app-admin-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6">
      <h1 class="text-xl font-bold text-slate-900">Ιστορικό ενεργειών</h1>
      <p class="mt-1 text-sm text-slate-500">
        Μη επεμβάσιμο αρχείο καταγραφής οικονομικών & ψηφοφοριών.
      </p>
    </div>

    <div class="card mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label class="label !mb-1 text-xs" for="auditAction">Δράση</label>
        <select
          id="auditAction"
          class="input !w-56"
          [value]="filters().action ?? ''"
          (change)="onActionChange($event)"
        >
          <option value="">Όλες</option>
          @for (action of actions; track action) {
            <option [value]="action">{{ actionLabel(action) }}</option>
          }
        </select>
      </div>
      <div>
        <label class="label !mb-1 text-xs" for="auditEntity">Οντότητα</label>
        <input
          id="auditEntity"
          type="text"
          class="input !w-40"
          placeholder="π.χ. expense"
          [value]="filters().entity ?? ''"
          (change)="onEntityChange($event)"
        />
      </div>
      <div>
        <label class="label !mb-1 text-xs" for="auditFrom">Από</label>
        <input
          id="auditFrom"
          type="date"
          class="input !w-40"
          [value]="fromDate()"
          (change)="onFromDateChange($event)"
        />
      </div>
      <div>
        <label class="label !mb-1 text-xs" for="auditTo">Έως</label>
        <input
          id="auditTo"
          type="date"
          class="input !w-40"
          [value]="toDate()"
          (change)="onToDateChange($event)"
        />
      </div>
      <button type="button" class="btn btn-primary" (click)="applyFilters()">
        Εφαρμογή
      </button>
    </div>

    @if (loading()) {
      <div class="card text-sm text-slate-500">Φόρτωση…</div>
    } @else if (error()) {
      <div class="card border-red-200 bg-red-50 text-sm text-red-700">
        Αποτυχία φόρτωσης ιστορικού.
      </div>
    } @else {
      <div class="card overflow-x-auto p-0">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ημερομηνία</th>
              <th>Δράση</th>
              <th>Οντότητα</th>
              <th>Χρήστης</th>
              <th>Λεπτομέρειες</th>
            </tr>
          </thead>
          <tbody>
            @for (item of items(); track item.id) {
              <tr>
                <td class="whitespace-nowrap">{{ time(item.createdAt) }}</td>
                <td>{{ actionLabel(item.action) }}</td>
                <td>{{ entityRef(item) }}</td>
                <td>
                  @if (roleBadge(item.actorRole); as badge) {
                    <span class="badge" [class]="badge.cls">{{ badge.label }}</span>
                  } @else {
                    <span class="text-slate-400">Σύστημα</span>
                  }
                </td>
                <td class="max-w-xs font-mono text-xs text-slate-600">
                  {{ details(item) }}
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="py-8 text-center text-slate-500">
                  Καμία καταγραφή.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm text-slate-600">
          <span>Ανά σελίδα</span>
          <select
            class="input !w-20 !py-1"
            [value]="pageSize()"
            (change)="onPageSizeChange($event)"
            aria-label="Ανά σελίδα"
          >
            @for (size of pageSizes; track size) {
              <option [value]="size">{{ size }}</option>
            }
          </select>
          <span>{{ total() }} εγγραφές</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="page() === 0"
            (click)="prevPage()"
          >
            Προηγούμενη
          </button>
          <span class="text-sm text-slate-600">Σελίδα {{ page() + 1 }}</span>
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="!hasNext()"
            (click)="nextPage()"
          >
            Επόμενη
          </button>
        </div>
      </div>
    }
  `,
})
export class AdminAuditPage implements OnInit {
  private readonly auditApi = inject(AuditApiService);
  private readonly toast = inject(ToastService);

  protected readonly actions = AUDIT_ACTIONS;
  protected readonly pageSizes = PAGE_SIZE_OPTIONS;
  protected readonly time = formatDateTime;

  protected readonly items = signal<AuditLogDto[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly filters = signal<AuditQueryDto>({});
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');
  protected readonly page = signal(0);
  protected readonly pageSize = signal(25);

  protected readonly hasNext = computed(
    () => (this.page() + 1) * this.pageSize() < this.total(),
  );

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.error.set(false);
    this.auditApi
      .list({
        ...this.filters(),
        skip: this.page() * this.pageSize(),
        take: this.pageSize(),
      })
      .pipe(
        catchError(() => {
          this.error.set(true);
          this.loading.set(false);
          this.toast.error('Η φόρτωση του ιστορικού απέτυχε.');
          return EMPTY;
        }),
      )
      .subscribe(({ items, total }) => {
        this.items.set(items);
        this.total.set(total);
        this.loading.set(false);
      });
  }

  protected applyFilters(): void {
    this.filters.set({
      ...this.filters(),
      fromISO: dateInputToIso(this.fromDate(), false),
      toISO: dateInputToIso(this.toDate(), true),
    });
    this.page.set(0);
    this.reload();
  }

  protected onActionChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.filters.set({ ...this.filters(), action: value || undefined });
    this.applyFilters();
  }

  protected onEntityChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.filters.set({ ...this.filters(), entity: value || undefined });
    this.applyFilters();
  }

  protected onFromDateChange(event: Event): void {
    this.fromDate.set((event.target as HTMLInputElement).value);
  }

  protected onToDateChange(event: Event): void {
    this.toDate.set((event.target as HTMLInputElement).value);
  }

  protected onPageSizeChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (PAGE_SIZE_OPTIONS.includes(value)) {
      this.pageSize.set(value);
      this.page.set(0);
      this.reload();
    }
  }

  protected prevPage(): void {
    if (this.page() === 0) return;
    this.page.set(this.page() - 1);
    this.reload();
  }

  protected nextPage(): void {
    if (!this.hasNext()) return;
    this.page.set(this.page() + 1);
    this.reload();
  }

  protected actionLabel(action: string): string {
    return AUDIT_ACTION_LABELS[action] ?? action;
  }

  protected entityRef(item: AuditLogDto): string {
    return item.entityId ? `${item.entity}#${shortRef(item.entityId)}` : item.entity;
  }

  protected roleBadge(role: AuditLogDto['actorRole']): { cls: string; label: string } | null {
    return role ? (ROLE_BADGES[role] ?? null) : null;
  }

  protected details(item: AuditLogDto): string {
    const meta = prettyMetadata(item.metadata);
    return meta !== '—' ? meta : shortRef(item.ip ?? null);
  }
}
