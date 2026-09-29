import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding, requireValidPeriod } from '../common/tenant';
import { AuditService } from '../audit/audit.service';
import { resolveAllocationWeights } from '../expenses/allocation-weights';
import { PrismaService } from '../prisma/prisma.service';
import { splitByLargestRemainder } from '../prisma/split-by-largest-remainder';
import { CreateRecurringExpenseDto } from './dto/create-recurring.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring.dto';

@Injectable()
export class RecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);

    return this.prisma.recurringExpense.findMany({
      where: { buildingId },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    buildingId: string,
    dto: CreateRecurringExpenseDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    await this.assertCategory(buildingId, dto.categoryId);

    const template = await this.prisma.recurringExpense.create({
      data: {
        buildingId,
        name: dto.name,
        amountCents: dto.amountCents,
        strategy: dto.strategy,
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      include: { category: true },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'recurring.created',
      entity: 'recurring_expense',
      entityId: template.id,
      metadata: { name: template.name, amountCents: template.amountCents },
    });
    return template;
  }

  async update(
    buildingId: string,
    id: string,
    dto: UpdateRecurringExpenseDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const template = await this.findOwned(buildingId, id);
    await this.assertCategory(buildingId, dto.categoryId);

    const updated = await this.prisma.recurringExpense.update({
      where: { id: template.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.amountCents !== undefined
          ? { amountCents: dto.amountCents }
          : {}),
        ...(dto.strategy !== undefined ? { strategy: dto.strategy } : {}),
        ...(dto.categoryId !== undefined
          ? { categoryId: dto.categoryId }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      include: { category: true },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'recurring.updated',
      entity: 'recurring_expense',
      entityId: updated.id,
      metadata: { active: updated.active, amountCents: updated.amountCents },
    });
    return updated;
  }

  async remove(buildingId: string, id: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const template = await this.findOwned(buildingId, id);
    await this.prisma.recurringExpense.delete({ where: { id: template.id } });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'recurring.deleted',
      entity: 'recurring_expense',
      entityId: template.id,
      metadata: { name: template.name },
    });
  }

  /**
   * Materializes every due active template into an Expense + Shares for the
   * given `YYYY-MM` period. Idempotent: templates with lastPeriod >= period
   * are skipped, so a second call for the same period creates nothing.
   */
  async generate(
    buildingId: string,
    periodYearMonth: string,
    user: AuthenticatedUser,
  ): Promise<{ created: number }> {
    assertSameBuilding(user, buildingId);
    const period = requireValidPeriod(periodYearMonth);

    // YYYY-MM strings sort lexicographically, so `lt` is a month comparison.
    const due = await this.prisma.recurringExpense.findMany({
      where: {
        buildingId,
        active: true,
        OR: [{ lastPeriod: null }, { lastPeriod: { lt: period } }],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (due.length === 0) {
      return { created: 0 };
    }

    const units = await this.prisma.unit.findMany({
      where: { buildingId },
      orderBy: { label: 'asc' },
    });
    if (units.length === 0) {
      throw new BadRequestException('Building has no units to allocate to');
    }

    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const template of due) {
        // Expense.categoryId is NOT NULL — templates need a category.
        if (!template.categoryId) {
          continue;
        }
        const inputs = resolveAllocationWeights(units, template.strategy);
        const splits = splitByLargestRemainder(template.amountCents, inputs);
        const expense = await tx.expense.create({
          data: {
            buildingId,
            categoryId: template.categoryId,
            description: template.name,
            totalCents: template.amountCents,
            periodYearMonth: period,
            createdById: user.id,
          },
        });
        await tx.share.createMany({
          data: splits.map((split) => ({
            expenseId: expense.id,
            unitId: split.id,
            amountCents: split.amountCents,
          })),
        });
        await tx.recurringExpense.update({
          where: { id: template.id },
          data: { lastPeriod: period },
        });
        created += 1;
      }
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'recurring.generated',
      entity: 'recurring_expense',
      entityId: null,
      metadata: { periodYearMonth: period, created },
    });

    return { created };
  }

  private findOwned(buildingId: string, id: string) {
    return this.prisma.recurringExpense
      .findFirst({ where: { id, buildingId } })
      .then((template) => {
        if (!template) {
          throw new NotFoundException('Recurring expense not found');
        }
        return template;
      });
  }

  private async assertCategory(
    buildingId: string,
    categoryId: string | undefined,
  ): Promise<void> {
    if (categoryId === undefined) {
      return;
    }
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, buildingId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }
}
