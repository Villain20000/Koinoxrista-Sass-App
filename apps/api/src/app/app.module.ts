import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { UnitsModule } from '../units/units.module';
import { OwnershipsModule } from '../ownerships/ownerships.module';
import { ExpenseCategoriesModule } from '../expense-categories/expense-categories.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { RemindersModule } from '../reminders/reminders.module';
import { ExportsModule } from '../exports/exports.module';
import { VotesModule } from '../votes/votes.module';
import { JobsModule } from '../jobs/jobs.module';
import { DocumentsModule } from '../documents/documents.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { MyDataModule } from '../mydata/mydata.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { GdprModule } from '../gdpr/gdpr.module';
import { AuditModule } from '../audit/audit.module';
import { ProvidersModule } from '../providers/providers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecurringModule } from '../recurring/recurring.module';
import { BankImportModule } from '../bank-import/bank-import.module';
import { ReportsModule } from '../reports/reports.module';
import { InvitesModule } from '../invites/invites.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { TransferModule } from '../transfer/transfer.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { ReserveModule } from '../reserve/reserve.module';
import { ExcelImportModule } from '../excel-import/excel-import.module';
import { LateFeesModule } from '../late-fees/late-fees.module';
import { AccountantSeatModule } from '../accountant-seat/accountant-seat.module';
import { SelfBillingModule } from '../self-billing/self-billing.module';
import { AssemblyModule } from '../assembly/assembly.module';
import { OpenBankingModule } from '../openbanking/openbanking.module';
import { MetersModule } from '../meters/meters.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { PaymentPlansModule } from '../payment-plans/payment-plans.module';
import { BrandingModule } from '../branding/branding.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { PartnersModule } from '../partners/partners.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { SupplierInvoicesModule } from '../supplier-invoices/supplier-invoices.module';
import { LegalModule } from '../legal/legal.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { PdfModule } from '../pdf/pdf.module';
import { OpenRegistrationModule } from '../open-registration/open-registration.module';
import { PointsModule } from '../points/points.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { InspectionsModule } from '../inspections/inspections.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { KpiModule } from '../kpi/kpi.module';
import { ShopModule } from '../shop/shop.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { AssistantModule } from '../assistant/assistant.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    BuildingsModule,
    UnitsModule,
    OwnershipsModule,
    ExpenseCategoriesModule,
    ExpensesModule,
    // InvoicesModule must register before PaymentsModule so `invoices/mine`
    // wins route resolution over the parameterized invoices controller.
    InvoicesModule,
    PaymentsModule,
    RemindersModule,
    ExportsModule,
    VotesModule,
    JobsModule,
    DocumentsModule,
    MembershipsModule,
    MyDataModule,
    ApiKeysModule,
    SubscriptionsModule,
    GdprModule,
    AuditModule,
    ProvidersModule,
    NotificationsModule,
    RecurringModule,
    BankImportModule,
    ReportsModule,
    InvitesModule,
    ComplianceModule,
    BudgetsModule,
    TransferModule,
    PayoutsModule,
    TreasuryModule,
    ReserveModule,
    ExcelImportModule,
    LateFeesModule,
    AccountantSeatModule,
    SelfBillingModule,
    AssemblyModule,
    OpenBankingModule,
    MetersModule,
    AnnouncementsModule,
    PaymentPlansModule,
    BrandingModule,
    MarketplaceModule,
    ReferralsModule,
    PartnersModule,
    MaintenanceModule,
    SupplierInvoicesModule,
    LegalModule,
    TenancyModule,
    RealtimeModule,
    SchedulerModule,
    PdfModule,
    OpenRegistrationModule,
    PointsModule,
    CampaignsModule,
    InspectionsModule,
    WebhooksModule,
    KpiModule,
    ShopModule,
    PermissionsModule,
    AssistantModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
