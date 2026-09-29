import { Injectable, NotFoundException } from '@nestjs/common';
import { SupplierPaymentMethod, type Prisma } from '@prisma/client';
import type { MyPayoutDto, PayoutSummaryDto } from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { UpdateSupplierPaymentDto } from './dto/update-supplier-payment.dto';

const PAYMENT_WITH_LABELS = {
  include: {
    job: { select: { title: true } },
    expense: { select: { description: true } },
  },
} satisfies Prisma.SupplierPaymentDefaultArgs;

/** Year window [Jan 1, next Jan 1) in UTC for `paidAt` filtering. */
function yearRange(year: number): Prisma.DateTimeFilter {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    buildingId: string,
    user: AuthenticatedUser,
    year?: number,
    jobId?: string,
  ) {
    assertSameBuilding(user, buildingId);

    return this.prisma.supplierPayment
      .findMany({
        where: {
          buildingId,
          ...(year ? { paidAt: yearRange(year) } : {}),
          ...(jobId ? { jobId } : {}),
        },
        ...PAYMENT_WITH_LABELS,
        orderBy: { paidAt: 'desc' },
      })
      .then((payments) =>
        payments.map((payment) => ({
          id: payment.id,
          buildingId: payment.buildingId,
          amountCents: payment.amountCents,
          method: payment.method,
          paidAt: payment.paidAt.toISOString(),
          jobId: payment.jobId,
          expenseId: payment.expenseId,
          reference: payment.reference,
          notes: payment.notes,
          jobTitle: payment.job?.title ?? null,
          expenseDescription: payment.expense?.description ?? null,
          createdAt: payment.createdAt.toISOString(),
        })),
      );
  }

  async create(
    buildingId: string,
    dto: CreateSupplierPaymentDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    await this.assertLinkedEntity(buildingId, dto.jobId, dto.expenseId);

    const payment = await this.prisma.supplierPayment.create({
      data: {
        buildingId,
        amountCents: dto.amountCents,
        method: dto.method,
        paidAt: new Date(dto.paidAt),
        ...(dto.jobId !== undefined ? { jobId: dto.jobId } : {}),
        ...(dto.expenseId !== undefined ? { expenseId: dto.expenseId } : {}),
        ...(dto.reference !== undefined && dto.reference !== ''
          ? { reference: dto.reference }
          : {}),
        ...(dto.notes !== undefined && dto.notes !== ''
          ? { notes: dto.notes }
          : {}),
        createdById: user.id,
      },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'supplier-payment.create',
      entity: 'supplier_payment',
      entityId: payment.id,
      metadata: {
        amountCents: payment.amountCents,
        method: payment.method as SupplierPaymentMethod,
      },
    });
    return payment;
  }

  async update(
    buildingId: string,
    id: string,
    dto: UpdateSupplierPaymentDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const existing = await this.findOwned(buildingId, id);

    if (dto.jobId || dto.expenseId) {
      await this.assertLinkedEntity(buildingId, dto.jobId, dto.expenseId);
    }

    const updated = await this.prisma.supplierPayment.update({
      where: { id: existing.id },
      data: {
        ...(dto.amountCents !== undefined ? { amountCents: dto.amountCents } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.paidAt !== undefined ? { paidAt: new Date(dto.paidAt) } : {}),
        ...(dto.jobId !== undefined ? { jobId: dto.jobId } : {}),
        ...(dto.expenseId !== undefined ? { expenseId: dto.expenseId } : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'supplier-payment.update',
      entity: 'supplier_payment',
      entityId: updated.id,
      metadata: {
        amountCents: updated.amountCents,
        method: updated.method as SupplierPaymentMethod,
      },
    });
    return updated;
  }

  async remove(buildingId: string, id: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const existing = await this.findOwned(buildingId, id);
    await this.prisma.supplierPayment.delete({ where: { id: existing.id } });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'supplier-payment.delete',
      entity: 'supplier_payment',
      entityId: existing.id,
      metadata: {
        amountCents: existing.amountCents,
        method: existing.method as SupplierPaymentMethod,
      },
    });
  }

  async summary(
    buildingId: string,
    user: AuthenticatedUser,
    year?: number,
  ): Promise<PayoutSummaryDto> {
    assertSameBuilding(user, buildingId);
    const resolvedYear = year ?? new Date().getUTCFullYear();

    const window = yearRange(resolvedYear);
    const payments = (
      await this.prisma.supplierPayment.findMany({
        where: { buildingId, paidAt: window },
        select: { amountCents: true, method: true, paidAt: true },
      })
    ).filter(
      (payment) => payment.paidAt >= (window.gte as Date) && payment.paidAt < (window.lt as Date),
    );

    let totalCents = 0;
    const methods = new Map<SupplierPaymentMethod, number>();
    const months = new Map<string, number>();
    for (const payment of payments) {
      totalCents += payment.amountCents;
      methods.set(
        payment.method,
        (methods.get(payment.method) ?? 0) + payment.amountCents,
      );
      const month = payment.paidAt.toISOString().slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + payment.amountCents);
    }

    return {
      totalCents,
      byMethod: [...methods.entries()]
        .map(([method, cents]) => ({ method, totalCents: cents }))
        .sort((a, b) => b.totalCents - a.totalCents),
      byMonth: [...months.entries()]
        .map(([month, cents]) => ({ month, totalCents: cents }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  /**
   * PROVIDER view: payments tied to jobs where the caller holds the ACCEPTED
   * (awarded) bid, newest first.
   */
  async mine(user: Pick<AuthenticatedUser, 'id'>): Promise<MyPayoutDto[]> {
    const payments = await this.prisma.supplierPayment.findMany({
      where: {
        job: {
          bids: {
            some: { providerUserId: user.id, status: 'ACCEPTED' },
          },
        },
      },
      include: { job: { select: { title: true } } },
      orderBy: { paidAt: 'desc' },
    });

    return payments.map((payment) => ({
      id: payment.id,
      jobTitle: payment.job?.title ?? '',
      amountCents: payment.amountCents,
      method: payment.method,
      paidAt: payment.paidAt.toISOString(),
      reference: payment.reference,
    }));
  }

  private findOwned(buildingId: string, id: string) {
    return this.prisma.supplierPayment
      .findFirst({ where: { id, buildingId } })
      .then((payment) => {
        if (!payment) {
          throw new NotFoundException('Supplier payment not found');
        }
        return payment;
      });
  }

  /** 404s when the linked job/expense does not belong to the building. */
  private async assertLinkedEntity(
    buildingId: string,
    jobId?: string | null,
    expenseId?: string | null,
  ): Promise<void> {
    if (jobId) {
      const job = await this.prisma.job.findFirst({
        where: { id: jobId, buildingId },
      });
      if (!job) throw new NotFoundException('Job not found');
    }
    if (expenseId) {
      const expense = await this.prisma.expense.findFirst({
        where: { id: expenseId, buildingId },
      });
      if (!expense) throw new NotFoundException('Expense not found');
    }
  }
}
