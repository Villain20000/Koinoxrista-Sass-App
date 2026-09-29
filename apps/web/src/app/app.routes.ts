import { Route } from '@angular/router';
import { canActivateRole, canActivateAuthed, homeRedirectGuard } from './core/role.guard';
import { LayoutComponent } from './layout/layout.component';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [homeRedirectGuard],
    children: [],
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/auth/login.component').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./pages/auth/register.component').then((m) => m.RegisterPage),
  },
  {
    path: 'admin',
    component: LayoutComponent,
    canActivate: [canActivateRole('ADMIN', 'BUILDING_OWNER')],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin/admin-overview.component').then(
            (m) => m.AdminOverviewPage,
          ),
      },
      {
        path: 'units',
        loadComponent: () =>
          import('./pages/admin/admin-units.component').then(
            (m) => m.AdminUnitsPage,
          ),
      },
      {
        path: 'categories',
        loadComponent: () =>
          import('./pages/admin/admin-categories.component').then(
            (m) => m.AdminCategoriesPage,
          ),
      },
      {
        path: 'expenses',
        loadComponent: () =>
          import('./pages/admin/admin-expenses.component').then(
            (m) => m.AdminExpensesPage,
          ),
      },
      {
        path: 'run',
        loadComponent: () =>
          import('./pages/admin/admin-run.component').then(
            (m) => m.AdminRunPage,
          ),
      },
      {
        path: 'arrears',
        loadComponent: () =>
          import('./pages/admin/admin-arrears.component').then(
            (m) => m.AdminArrearsPage,
          ),
      },
      {
        path: 'votes',
        loadComponent: () =>
          import('./pages/admin/admin-votes.component').then(
            (m) => m.AdminVotesPage,
          ),
      },
      {
        path: 'jobs',
        loadComponent: () =>
          import('./pages/admin/admin-jobs.component').then(
            (m) => m.AdminJobsPage,
          ),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('./pages/admin/admin-documents.component').then(
            (m) => m.AdminDocumentsPage,
          ),
      },
      {
        path: 'subscription',
        loadComponent: () =>
          import('./pages/admin/admin-subscription.component').then(
            (m) => m.AdminSubscriptionPage,
          ),
      },
      {
        path: 'audit',
        loadComponent: () =>
          import('./pages/admin/admin-audit.component').then(
            (m) => m.AdminAuditPage,
          ),
      },
      {
        path: 'directory',
        loadComponent: () =>
          import('./pages/admin/admin-directory.component').then(
            (m) => m.AdminDirectoryPage,
          ),
      },
      {
        path: 'recurring',
        loadComponent: () =>
          import('./pages/admin/admin-recurring.component').then(
            (m) => m.AdminRecurringPage,
          ),
      },
      {
        path: 'bank-import',
        loadComponent: () =>
          import('./pages/admin/admin-bank-import.component').then(
            (m) => m.AdminBankImportPage,
          ),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./pages/admin/admin-analytics.component').then(
            (m) => m.AdminAnalyticsPage,
          ),
      },
      {
        path: 'invites',
        loadComponent: () =>
          import('./pages/admin/admin-invites.component').then(
            (m) => m.AdminInvitesPage,
          ),
      },
      {
        path: 'compliance',
        loadComponent: () =>
          import('./pages/admin/admin-compliance.component').then(
            (m) => m.AdminCompliancePage,
          ),
      },
      {
        path: 'budgets',
        loadComponent: () =>
          import('./pages/admin/admin-budgets.component').then(
            (m) => m.AdminBudgetsPage,
          ),
      },
      {
        path: 'transfer',
        loadComponent: () =>
          import('./pages/admin/admin-transfer.component').then(
            (m) => m.AdminTransferPage,
          ),
      },
      {
        path: 'payouts',
        loadComponent: () =>
          import('./pages/admin/admin-payouts.component').then(
            (m) => m.AdminPayoutsPage,
          ),
      },
      {
        path: 'import',
        loadComponent: () =>
          import('./pages/admin/admin-excel-import.component').then(
            (m) => m.AdminExcelImportPage,
          ),
      },
      {
        path: 'late-fees',
        loadComponent: () =>
          import('./pages/admin/admin-late-fees.component').then(
            (m) => m.AdminLateFeesPage,
          ),
      },
      {
        path: 'accountants',
        loadComponent: () =>
          import('./pages/admin/admin-accountants.component').then(
            (m) => m.AdminAccountantsPage,
          ),
      },
      {
        path: 'billing',
        loadComponent: () =>
          import('./pages/admin/admin-billing.component').then(
            (m) => m.AdminBillingPage,
          ),
      },
      {
        path: 'votes/:id/assembly',
        loadComponent: () =>
          import('./pages/admin/admin-assembly.component').then(
            (m) => m.AdminAssemblyPage,
          ),
      },
      {
        path: 'praktiko/:voteId',
        loadComponent: () =>
          import('./pages/admin/admin-praktiko.component').then(
            (m) => m.AdminPraktikoPage,
          ),
      },
      {
        path: 'open-banking',
        loadComponent: () =>
          import('./pages/admin/admin-openbanking.component').then(
            (m) => m.AdminOpenBankingPage,
          ),
      },
      {
        path: 'meters',
        loadComponent: () =>
          import('./pages/admin/admin-meters.component').then(
            (m) => m.AdminMetersPage,
          ),
      },
      {
        path: 'announcements',
        loadComponent: () =>
          import('./pages/admin/admin-announcements.component').then(
            (m) => m.AdminAnnouncementsPage,
          ),
      },
      {
        path: 'payment-plans',
        loadComponent: () =>
          import('./pages/admin/admin-payment-plans.component').then(
            (m) => m.AdminPaymentPlansPage,
          ),
      },
      {
        path: 'branding',
        loadComponent: () =>
          import('./pages/admin/admin-branding.component').then(
            (m) => m.AdminBrandingPage,
          ),
      },
      {
        path: 'commissions',
        loadComponent: () =>
          import('./pages/admin/admin-commissions.component').then(
            (m) => m.AdminCommissionsPage,
          ),
      },
      {
        path: 'partners',
        loadComponent: () =>
          import('./pages/admin/admin-partners.component').then(
            (m) => m.AdminPartnersPage,
          ),
      },
      {
        path: 'referrals',
        loadComponent: () =>
          import('./pages/admin/admin-referrals.component').then(
            (m) => m.AdminReferralsPage,
          ),
      },
      {
        path: 'maintenance',
        loadComponent: () =>
          import('./pages/admin/admin-maintenance.component').then(
            (m) => m.AdminMaintenancePage,
          ),
      },
      {
        path: 'legal',
        loadComponent: () =>
          import('./pages/admin/admin-legal.component').then(
            (m) => m.AdminLegalPage,
          ),
      },
      {
        path: 'supplier-invoices',
        loadComponent: () =>
          import('./pages/admin/admin-supplier-invoices.component').then(
            (m) => m.AdminSupplierInvoicesPage,
          ),
      },
      {
        path: 'treasury',
        loadComponent: () =>
          import('./pages/admin/admin-treasury.component').then((m) => m.AdminTreasuryPage),
      },
      {
        path: 'reserve',
        loadComponent: () =>
          import('./pages/admin/admin-reserve.component').then((m) => m.AdminReservePage),
      },
      {
        path: 'occupancy',
        loadComponent: () =>
          import('./pages/admin/admin-occupancy.component').then((m) => m.AdminOccupancyPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/admin/admin-settings.component').then((m) => m.AdminSettingsPage),
      },
    ],
  },
  {
    path: 'accountant',
    component: LayoutComponent,
    canActivate: [canActivateRole('ACCOUNTANT')],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/accountant/accountant-home.component').then(
            (m) => m.AccountantHomePage,
          ),
      },
      {
        path: 'buildings/:buildingId/apologismos',
        loadComponent: () =>
          import('./pages/accountant/accountant-apologismos.component').then(
            (m) => m.AccountantApologismosPage,
          ),
      },
    ],
  },
  {
    path: 'settings/security',
    component: LayoutComponent,
    canActivate: [canActivateAuthed],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/settings/security-settings.component').then(
            (m) => m.SecuritySettingsPage,
          ),
      },
    ],
  },
  {
    path: 'balance',
    component: LayoutComponent,
    canActivate: [canActivateRole('RESIDENT')],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/balance/balance.component').then((m) => m.BalancePage),
      },
      {
        path: 'statement',
        loadComponent: () =>
          import('./pages/balance/resident-statement.component').then(
            (m) => m.ResidentStatementPage,
          ),
      },
      {
        path: 'plan',
        loadComponent: () =>
          import('./pages/balance/resident-payment-plan.component').then(
            (m) => m.ResidentPaymentPlanPage,
          ),
      },
    ],
  },
  {
    path: 'votes',
    component: LayoutComponent,
    canActivate: [canActivateRole('RESIDENT')],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/resident/resident-votes.component').then(
            (m) => m.ResidentVotesPage,
          ),
      },
    ],
  },
  {
    path: 'defects',
    component: LayoutComponent,
    canActivate: [canActivateRole('RESIDENT')],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/resident/resident-defects.component').then(
            (m) => m.ResidentDefectsPage,
          ),
      },
    ],
  },
  {
    path: 'provider',
    component: LayoutComponent,
    canActivate: [canActivateRole('PROVIDER')],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/provider/provider-portal.component').then(
            (m) => m.ProviderPortalPage,
          ),
      },
    ],
  },
  {
    path: 'feed',
    component: LayoutComponent,
    canActivate: [canActivateRole('RESIDENT')],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/resident/resident-feed.component').then(
            (m) => m.ResidentFeedPage,
          ),
      },
    ],
  },
  { path: 'provider-home', redirectTo: '/provider', pathMatch: 'full' },
  {
    path: '**',
    canActivate: [homeRedirectGuard],
    children: [],
  },
];
