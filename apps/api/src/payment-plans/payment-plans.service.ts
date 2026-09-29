import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PaymentPlan, PaymentPlanInstallment } from '@prisma/client';
import type {
  CreatePaymentPlanDto,
  InstallmentDto,
  PaymentPlanDto,
  PaymentPlanStatus,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPlanPaymentDto } from './dto/record-plan-payment.dto';
import {
  applyPaymentToPlan,
  installmentRemaining,
  splitIntoInstallments,
} from './payment-plan-calc';

const PLAN_STATUSES: PaymentPlanStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED'];

/** Plan rows with their schedule and the unit label for listings. */
const PLAN_WITH_SCHEDULE = {
  include: {
    unit: { select: { label: true } },
    installments: { orderBy: { seq: 'asc' as const } },
  },
};

@Injectable()
export class PaymentPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Splits a unit's arrears into installments. Idempotent at most ONE ACTIVE
   * plan per unit: a second creation attempt while one is running is a 409.
   */
  async create(
    buildingId: string,
    dto: CreatePaymentPlanDto,
    user: AuthenticatedUser,
  ): Promise<PaymentPlanDto> {
    assertSameBuilding(user, buildingId);

    const unit = await this.prisma.unit.findFirst({
      where: { id: dto.unitId, buildingId },
      select: { id: true, label: true },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    const active = await this.prisma.paymentPlan.findFirst({
      where: { unitId: unit.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException('Unit already has an active payment plan');
    }

    const totalCents =
      dto.totalCents !== undefined ? dto.totalCents : await this.arrearsFor(unit.id);
    if (!Number.isInteger(totalCents) || totalCents <= 0) {
      throw new BadRequestException('totalCents must be a positive integer amount');
    }

    const intervalDays = dto.intervalDays ?? 30;
    const firstDueDate = new Date(dto.firstDueDate);
    if (Number.isNaN(firstDueDate.getTime())) {
      throw new BadRequestException('firstDueDate must be a valid ISO date');
    }

    const schedule = splitIntoInstallments(totalCents, dto.installmentCount, firstDueDate, intervalDays);
    const plan = await this.prisma.paymentPlan.create({
      data: {
        buildingId,
        unitId: unit.id,
        totalCents,
        installmentCount: dto.installmentCount,
        status: 'ACTIVE',
        installments: {
          create: schedule.map((installment) => ({
            seq: installment.seq,
            dueDate: installment.dueDate,
            amountCents: installment.amountCents,
          })),
        },
      },
      ...PLAN_WITH_SCHEDULE,
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'payment-plan.create',
      entity: 'payment_plan',
      entityId: plan.id,
      metadata: {
        unitId: unit.id,
        totalCents,
        installmentCount: dto.installmentCount,
        intervalDays,
        firstDueDate: firstDueDate.toISOString(),
      },
    });

    return this.toPlanDto(plan);
  }

  /** Plans of the building, newest first; optional status filter. */
  async list(
    buildingId: string,
    user: AuthenticatedUser,
    status?: string,
  ): Promise<PaymentPlanDto[]> {
    assertSameBuilding(user, buildingId);
    this.assertKnownStatus(status);

    const plans = await this.prisma.paymentPlan.findMany({
      where: { buildingId, ...(status ? { status } : {}) },
      ...PLAN_WITH_SCHEDULE,
      orderBy: { createdAt: 'desc' },
    });
    return plans.map((plan) => this.toPlanDto(plan));
  }

  /** Full schedule with running totals. */
  async get(id: string, user: AuthenticatedUser): Promise<PaymentPlanDto> {
    const plan = await this.findOwned(id, user);
    return this.toPlanDto(plan);
  }

  /**
   * Records a payment against an ACTIVE plan; money is allocated oldest-first
   * (lowest seq), partial installment balances allowed. The plan transitions
   * to COMPLETED when every installment is fully settled.
   */
  async recordPayment(
    id: string,
    dto: RecordPlanPaymentDto,
    user: AuthenticatedUser,
  ): Promise<PaymentPlanDto> {
    const plan = await this.findOwned(id, user);
    if (plan.status !== 'ACTIVE') {
      throw new ConflictException(`Plan is ${plan.status}; only ACTIVE plans accept payments`);
    }

    const remainingCents = plan.installments.reduce(
      (sum, installment) => sum + installmentRemaining(installment),
      0,
    );
    if (dto.amountCents > remainingCents) {
      throw new BadRequestException(
        `amountCents exceeds the plan's remaining balance (${remainingCents})`,
      );
    }

    const paidAt = new Date();
    const result = applyPaymentToPlan(plan.installments, dto.amountCents, paidAt);

    const touched = result.installments
      .map((updated) => ({
        updated,
        original: plan.installments.find((i) => i.id === updated.id),
      }))
      .filter(
        ({ updated, original }) =>
          original &&
          (original.paidCents !== updated.paidCents ||
            original.paidAt?.getTime() !== updated.paidAt?.getTime()),
      );

    await this.prisma.$transaction([
      ...touched.map(({ updated }) =>
        this.prisma.paymentPlanInstallment.update({
          where: { id: updated.id },
          data: { paidCents: updated.paidCents, paidAt: updated.paidAt },
        }),
      ),
      ...(result.completed
        ? [
            this.prisma.paymentPlan.update({
              where: { id: plan.id },
              data: { status: 'COMPLETED' },
            }),
          ]
        : []),
    ]);

    this.audit.record({
      buildingId: plan.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'payment-plan.payment',
      entity: 'payment_plan',
      entityId: plan.id,
      metadata: {
        amountCents: result.appliedCents,
        allocations: result.allocations,
        completed: result.completed,
      },
    });

    return this.get(id, user);
  }

  /**
   * Cancels an ACTIVE plan: remaining (not fully settled) installments are
   * removed and the removal is audited with their exact amounts.
   */
  async cancel(id: string, user: AuthenticatedUser): Promise<PaymentPlanDto> {
    const plan = await this.findOwned(id, user);
    if (plan.status !== 'ACTIVE') {
      throw new ConflictException(`Plan is already ${plan.status}`);
    }

    const cancelled = plan.installments.filter(
      (installment) => installmentRemaining(installment) > 0,
    );
    const cancelledCents = cancelled.reduce(
      (sum, installment) => sum + installmentRemaining(installment),
      0,
    );

    await this.prisma.$transaction([
      this.prisma.paymentPlanInstallment.deleteMany({
        where: { id: { in: cancelled.map((installment) => installment.id) } },
      }),
      this.prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      }),
    ]);

    this.audit.record({
      buildingId: plan.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'payment-plan.cancel',
      entity: 'payment_plan',
      entityId: plan.id,
      metadata: {
        unitId: plan.unitId,
        cancelledInstallments: cancelled.map((installment) => ({
          seq: installment.seq,
          amountCents: installment.amountCents,
          paidCents: installment.paidCents,
        })),
        cancelledCents,
      },
    });

    return this.get(id, user);
  }

  /**
   * RESIDENT view: the caller's own active plan schedule, resolved through the
   * same ownership link the balance endpoints use.
   */
  async myActivePlan(user: AuthenticatedUser): Promise<PaymentPlanDto> {
    const ownerships = await this.prisma.ownership.findMany({
      where: { userId: user.id },
      select: { unitId: true },
    });
    const unitIds = ownerships.map((ownership) => ownership.unitId);
    if (unitIds.length === 0) {
      throw new ForbiddenException('User owns no units');
    }

    const plan = await this.prisma.paymentPlan.findFirst({
      where: { unitId: { in: unitIds }, status: 'ACTIVE' },
      ...PLAN_WITH_SCHEDULE,
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) throw new NotFoundException('No active payment plan');

    return this.toPlanDto(plan);
  }

  /**
   * Unit arrears exactly like the aging report computes them:
   * Σ max(0, total − paid) across all of the unit's invoices.
   */
  private async arrearsFor(unitId: string): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: { unitId },
      select: { totalCents: true, paidCents: true },
    });
    return invoices.reduce(
      (sum, invoice) =>
        sum + Math.max(0, invoice.totalCents - invoice.paidCents),
      0,
    );
  }

  private async findOwned(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PaymentPlan & { installments: PaymentPlanInstallment[]; unit: { label: string } }> {
    const plan = await this.prisma.paymentPlan.findFirst({
      where: { id },
      ...PLAN_WITH_SCHEDULE,
    });
    if (!plan) throw new NotFoundException('Payment plan not found');
    assertSameBuilding(user, plan.buildingId);
    return plan;
  }

  private assertKnownStatus(status?: string): void {
    if (status && !PLAN_STATUSES.includes(status as PaymentPlanStatus)) {
      throw new BadRequestException(
        `status must be one of ${PLAN_STATUSES.join(', ')}`,
      );
    }
  }

  private toPlanDto(plan: PaymentPlan & {
    installments: PaymentPlanInstallment[];
    unit?: { label: string } | null;
  }): PaymentPlanDto {
    const paidCents = plan.installments.reduce((sum, i) => sum + i.paidCents, 0);
    return {
      id: plan.id,
      buildingId: plan.buildingId,
      unitId: plan.unitId,
      totalCents: plan.totalCents,
      installmentCount: plan.installmentCount,
      status: plan.status as PaymentPlanStatus,
      createdAt: plan.createdAt.toISOString(),
      cancelledAt: plan.cancelledAt ? plan.cancelledAt.toISOString() : null,
      paidCents,
      remainingCents: Math.max(0, plan.totalCents - paidCents),
      unitLabel: plan.unit?.label ?? null,
      installments: plan.installments.map((installment) =>
        this.toInstallmentDto(installment),
      ),
    };
  }

  private toInstallmentDto(installment: PaymentPlanInstallment): InstallmentDto {
    return {
      id: installment.id,
      planId: installment.planId,
      seq: installment.seq,
      dueDate: installment.dueDate.toISOString(),
      amountCents: installment.amountCents,
      paidCents: installment.paidCents,
      paidAt: installment.paidAt ? installment.paidAt.toISOString() : null,
    };
  }
}
