import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { EMPTY, catchError } from 'rxjs';
import { Role } from '@org/shared';
import { AuthService } from '../core/auth.service';
import {
  NotificationApiService,
  NotificationDto,
} from '../core/notification-api.service';
import { RealtimeService } from '../core/realtime.service';
import { TranslatePipe } from '../core/translate.pipe';

interface NavLink {
  path: string;
  label: string;
  exact?: boolean;
}

interface NavGroup {
  label: string | null;
  links: NavLink[];
}

const NAV_GROUPS: Record<Role, NavGroup[]> = {
  ADMIN: [
    {
      label: 'nav.admin',
      links: [
        { path: '/admin', label: 'nav.overview', exact: true },
        { path: '/admin/units', label: 'nav.units' },
        { path: '/admin/categories', label: 'nav.categories' },
        { path: '/admin/expenses', label: 'nav.expenses' },
        { path: '/admin/run', label: 'nav.run' },
        { path: '/admin/arrears', label: 'nav.arrears' },
        { path: '/admin/documents', label: 'nav.documents' },
        { path: '/admin/jobs', label: 'nav.jobs' },
        { path: '/admin/votes', label: 'nav.votes' },
        { path: '/admin/subscription', label: 'nav.subscription' },
        { path: '/admin/audit', label: 'nav.audit' },
        { path: '/admin/directory', label: 'nav.directory' },
        { path: '/admin/recurring', label: 'nav.recurring' },
        { path: '/admin/bank-import', label: 'nav.bankImport' },
        { path: '/admin/analytics', label: 'nav.analytics' },
        { path: '/admin/invites', label: 'nav.invites' },
        { path: '/admin/compliance', label: 'nav.compliance' },
        { path: '/admin/budgets', label: 'nav.budgets' },
        { path: '/admin/payouts', label: 'nav.payouts' },
        { path: '/admin/supplier-invoices', label: 'nav.supplierInvoices' },
        { path: '/admin/treasury', label: 'nav.treasury' },
        { path: '/admin/reserve', label: 'nav.reserve' },
        { path: '/admin/occupancy', label: 'nav.occupancy' },
        { path: '/admin/transfer', label: 'nav.transfer' },
        { path: '/admin/import', label: 'nav.import' },
        { path: '/admin/late-fees', label: 'nav.lateFees' },
        { path: '/admin/accountants', label: 'nav.accountants' },
        { path: '/admin/billing', label: 'nav.billing' },
        { path: '/admin/open-banking', label: 'nav.openBanking' },
        { path: '/admin/meters', label: 'nav.meters' },
        { path: '/admin/announcements', label: 'nav.announcements' },
        { path: '/admin/payment-plans', label: 'nav.paymentPlans' },
        { path: '/admin/branding', label: 'nav.branding' },
        { path: '/admin/commissions', label: 'nav.commissions' },
        { path: '/admin/partners', label: 'nav.partners' },
        { path: '/admin/referrals', label: 'nav.referrals' },
        { path: '/admin/maintenance', label: 'nav.maintenance' },
        { path: '/admin/legal', label: 'nav.legal' },
        { path: '/admin/scheduler', label: 'nav.scheduler' },
        { path: '/admin/settings', label: 'nav.settings' },
      ],
    },
  ],
  ACCOUNTANT: [
    {
      label: null,
      links: [{ path: '/accountant', label: 'nav.accountant' }],
    },
  ],
  RESIDENT: [
    {
      label: null,
      links: [
        { path: '/balance', label: 'nav.balance' },
        { path: '/balance/statement', label: 'nav.statement' },
        { path: '/votes', label: 'nav.votes' },
        { path: '/feed', label: 'nav.feed' },
        { path: '/defects', label: 'nav.defects' },
      ],
    },
  ],
  PROVIDER: [
    {
      label: null,
      links: [{ path: '/provider', label: 'nav.provider' }],
    },
  ],
  // Feature 6: 理事長 — superset of the classic ADMIN nav.
  BUILDING_OWNER: [
    {
      label: 'nav.admin',
      links: [
        { path: '/admin', label: 'nav.overview', exact: true },
        { path: '/admin/units', label: 'nav.units' },
        { path: '/admin/categories', label: 'nav.categories' },
        { path: '/admin/expenses', label: 'nav.expenses' },
        { path: '/admin/run', label: 'nav.run' },
        { path: '/admin/arrears', label: 'nav.arrears' },
        { path: '/admin/documents', label: 'nav.documents' },
        { path: '/admin/jobs', label: 'nav.jobs' },
        { path: '/admin/votes', label: 'nav.votes' },
        { path: '/admin/subscription', label: 'nav.subscription' },
        { path: '/admin/audit', label: 'nav.audit' },
        { path: '/admin/directory', label: 'nav.directory' },
        { path: '/admin/recurring', label: 'nav.recurring' },
        { path: '/admin/bank-import', label: 'nav.bankImport' },
        { path: '/admin/analytics', label: 'nav.analytics' },
        { path: '/admin/invites', label: 'nav.invites' },
        { path: '/admin/compliance', label: 'nav.compliance' },
        { path: '/admin/budgets', label: 'nav.budgets' },
        { path: '/admin/scheduler', label: 'nav.scheduler' },
        { path: '/admin/payouts', label: 'nav.payouts' },
        { path: '/admin/supplier-invoices', label: 'nav.supplierInvoices' },
        { path: '/admin/treasury', label: 'nav.treasury' },
        { path: '/admin/reserve', label: 'nav.reserve' },
        { path: '/admin/occupancy', label: 'nav.occupancy' },
        { path: '/admin/transfer', label: 'nav.transfer' },
        { path: '/admin/import', label: 'nav.import' },
        { path: '/admin/late-fees', label: 'nav.lateFees' },
        { path: '/admin/accountants', label: 'nav.accountants' },
        { path: '/admin/billing', label: 'nav.billing' },
        { path: '/admin/open-banking', label: 'nav.openBanking' },
        { path: '/admin/meters', label: 'nav.meters' },
        { path: '/admin/announcements', label: 'nav.announcements' },
        { path: '/admin/payment-plans', label: 'nav.paymentPlans' },
        { path: '/admin/branding', label: 'nav.branding' },
        { path: '/admin/commissions', label: 'nav.commissions' },
        { path: '/admin/partners', label: 'nav.partners' },
        { path: '/admin/referrals', label: 'nav.referrals' },
        { path: '/admin/maintenance', label: 'nav.maintenance' },
        { path: '/admin/legal', label: 'nav.legal' },
        { path: '/admin/settings', label: 'nav.settings' },
      ],
    },
  ],
  PLATFORM_ADMIN: [
    {
      label: 'nav.platform',
      links: [
        { path: '/admin/billing', label: 'nav.billing' },
        { path: '/admin/partners', label: 'nav.partners' },
        { path: '/admin/referrals', label: 'nav.referrals' },
      ],
    },
  ],
};

export function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'τώρα';
  if (minutes < 60) return `πριν ${minutes}λ`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `πριν ${hours}ω`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `πριν ${days}η`;
  const months = Math.floor(days / 30);
  if (months < 12) return `πριν ${months}μ`;
  return `πριν ${Math.floor(months / 12)}χρ`;
}

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <div class="min-h-screen">
      <header
        class="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm"
      >
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="btn btn-secondary !px-2 md:hidden"
            (click)="menuOpen.set(!menuOpen())"
            [attr.aria-label]="'menu.open' | translate"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
              <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
            </svg>
          </button>
          <a routerLink="/" class="text-lg font-bold tracking-tight text-slate-900">
            PolykatoikiaOS
          </a>
        </div>
        <div class="flex items-center gap-3">
          @if (auth.memberships().length > 1) {
            <select
              class="input !w-44"
              [attr.aria-label]="'menu.building' | translate"
              [value]="activeBuildingId()"
              (change)="onSwitchBuilding($event)"
            >
              @for (membership of auth.memberships(); track membership.id) {
                <option [value]="membership.building.id">
                  {{ membership.building.name }}
                </option>
              }
            </select>
          }
          <span class="hidden text-sm text-slate-500 sm:inline">
            {{ auth.currentUser()?.email }}
          </span>
          <div class="relative" data-notifications>
            <button
              type="button"
              class="btn btn-secondary relative !px-2"
              (click)="toggleNotifications()"
              [attr.aria-label]="'nav.notifications' | translate"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="h-5 w-5"
              >
                <path
                  d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              @if (unreadCount() > 0) {
                <span
                  class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
                >
                  {{ unreadCount() > 99 ? '99+' : unreadCount() }}
                </span>
              }
            </button>
            @if (notifOpen()) {
              <div
                class="absolute right-0 z-50 mt-2 flex w-80 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
              >
                <div class="max-h-96 overflow-y-auto">
                  @for (item of notifications(); track item.id) {
                    <button
                      type="button"
                      class="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                      (click)="openNotification(item)"
                    >
                      <span
                        class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        [class.bg-slate-900]="!item.readAt"
                        [class.bg-transparent]="!!item.readAt"
                        [attr.aria-label]="item.readAt ? '' : ('nav.unread' | translate)"
                      ></span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-bold text-slate-900">
                          {{ item.title }}
                        </span>
                        <span class="block truncate text-xs text-slate-500">
                          {{ item.body }}
                        </span>
                        <span class="mt-0.5 block text-[10px] text-slate-400">
                          {{ formatTimeAgo(item.createdAt) }}
                        </span>
                      </span>
                    </button>
                  } @empty {
                    <p class="px-3 py-6 text-center text-sm text-slate-400">
                      {{ 'nav.noNotifications' | translate }}
                    </p>
                  }
                </div>
                <div class="flex items-center justify-between border-t border-slate-200 px-3 py-2">
                  <button
                    type="button"
                    class="text-xs font-medium text-slate-700 hover:underline"
                    (click)="markAllRead()"
                  >
                    {{ 'nav.markAllRead' | translate }}
                  </button>
                  <button
                    type="button"
                    class="text-xs text-slate-400 hover:text-slate-600"
                    (click)="notifOpen.set(false)"
                  >
                    {{ 'common.close' | translate }}
                  </button>
                </div>
              </div>
            }
          </div>
          <button type="button" class="btn btn-secondary" (click)="logout()">
            {{ 'nav.logout' | translate }}
          </button>
        </div>
      </header>

      @if (menuOpen()) {
        <button
          type="button"
          class="fixed inset-0 z-20 cursor-default bg-slate-900/40 md:hidden"
          (click)="menuOpen.set(false)"
          [attr.aria-label]="'menu.close' | translate"
        ></button>
      }

      <aside
        class="fixed top-14 bottom-0 left-0 z-30 w-56 transform overflow-y-auto border-r border-slate-200 bg-white p-4 transition-transform duration-200 md:translate-x-0"
        [class.-translate-x-full]="!menuOpen()"
      >
        <nav class="flex flex-col gap-4">
          @for (group of groups(); track group.label) {
            <div class="flex flex-col gap-1">
              @if (group.label) {
                <p class="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {{ group.label | translate }}
                </p>
              }
              @for (link of group.links; track link.path) {
                <a
                  [routerLink]="link.path"
                  routerLinkActive="bg-slate-900 text-white hover:bg-slate-700"
                  [routerLinkActiveOptions]="{ exact: link.exact ?? false }"
                  class="nav-link"
                  (click)="menuOpen.set(false)"
                >
                  {{ link.label | translate }}
                </a>
              }
            </div>
          }
        </nav>
      </aside>

      <main class="p-4 md:ml-56 lg:p-8">
        <div class="mx-auto max-w-5xl">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
export class LayoutComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notificationApi = inject(NotificationApiService);
  private readonly realtime = inject(RealtimeService);

  protected readonly menuOpen = signal(false);
  protected readonly notifOpen = signal(false);
  protected readonly notifications = signal<NotificationDto[]>([]);
  protected readonly unreadCount = signal(0);
  protected readonly formatTimeAgo = formatTimeAgo;
  protected readonly groups = computed(() => {
    const role = this.auth.role;
    if (!role) return [];
    return NAV_GROUPS[role];
  });
  protected readonly activeBuildingId = computed(
    () => this.auth.currentUser()?.buildingId ?? '',
  );

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.auth
      .fetchMyBuildings()
      .pipe(catchError(() => EMPTY))
      .subscribe();

    // Live notifications: push an incoming one to the top and bump the badge;
    // the 60s poll stays as a fallback for missed events.
    this.realtime.on<{
      type: string;
      title: string;
      body: string | null;
      linkPath: string | null;
    }>('notification.created', (event) => {
      const item: NotificationDto = {
        id: `live-${Date.now()}`,
        type: event.type,
        title: event.title,
        body: event.body ?? '',
        linkPath: event.linkPath ?? null,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
      this.notifications.update((items) => [item, ...items].slice(0, 30));
      this.unreadCount.update((count) => count + 1);
      void this.refreshNotifications();
    });

    effect(() => {
      const loggedIn = this.auth.currentUser() !== null;
      if (loggedIn && !this.pollTimer) {
        void this.refreshNotifications();
        this.pollTimer = setInterval(() => void this.refreshNotifications(), 60_000);
      } else if (!loggedIn && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        this.notifications.set([]);
        this.unreadCount.set(0);
        this.notifOpen.set(false);
      }
    });
  }

  protected toggleNotifications(): void {
    const open = !this.notifOpen();
    this.notifOpen.set(open);
    if (open) void this.refreshNotifications();
  }

  protected openNotification(item: NotificationDto): void {
    if (!item.readAt) {
      this.notificationApi
        .markRead(item.id)
        .pipe(catchError(() => EMPTY))
        .subscribe(() => this.applyRead(item.id));
    }
    this.notifOpen.set(false);
    if (item.linkPath) void this.router.navigateByUrl(item.linkPath);
  }

  protected markAllRead(): void {
    this.notificationApi
      .markAllRead()
      .pipe(catchError(() => EMPTY))
      .subscribe(() => {
        this.notifications.update((items) =>
          items.map((item) => ({
            ...item,
            readAt: item.readAt ?? new Date().toISOString(),
          })),
        );
        this.unreadCount.set(0);
      });
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.notifOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-notifications]')) return;
    this.notifOpen.set(false);
  }

  protected onSwitchBuilding(event: Event): void {
    const buildingId = (event.target as HTMLSelectElement).value;
    if (!buildingId || buildingId === this.activeBuildingId()) return;
    this.auth.switchBuilding(buildingId).subscribe(() => location.reload());
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  private refreshNotifications(): void {
    this.notificationApi
      .list({ take: 20 })
      .pipe(catchError(() => EMPTY))
      .subscribe((res) => {
        this.notifications.set(res.items);
        this.unreadCount.set(res.totalUnread);
      });
  }

  private applyRead(id: string): void {
    this.notifications.update((items) =>
      items.map((item) =>
        item.id === id && !item.readAt
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    this.unreadCount.update((count) => Math.max(0, count - 1));
  }
}
