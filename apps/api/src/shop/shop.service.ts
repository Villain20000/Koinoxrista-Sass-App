import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

export interface ProductView {
  id: string;
  buildingId: string;
  name: string;
  priceCents: number;
  stock: number;
  imageKey: string | null;
  active: boolean;
}

export interface ProductOrderView {
  id: string;
  buildingId: string;
  unitId: string;
  unitLabel: string;
  productId: string;
  productName: string;
  qty: number;
  amountCents: number;
  status: string;
  createdAt: string;
}

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Admin CRUD. */
  async listProducts(buildingId: string, user: AuthenticatedUser, activeOnly = false) {
    assertSameBuilding(user, buildingId);
    return this.prisma.product.findMany({
      where: { buildingId, ...(activeOnly ? { active: true } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async createProduct(
    buildingId: string,
    dto: { name: string; priceCents: number; stock?: number; imageKey?: string },
    user: AuthenticatedUser,
  ): Promise<ProductView> {
    assertSameBuilding(user, buildingId);
    this.requireAdmin(user);
    const product = await this.prisma.product.create({
      data: {
        buildingId,
        name: dto.name,
        priceCents: dto.priceCents,
        stock: dto.stock ?? 0,
        imageKey: dto.imageKey ?? null,
      },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'shop.product.create',
      entity: 'product',
      entityId: product.id,
      metadata: { name: product.name, priceCents: product.priceCents },
    });
    return this.toProductView(product);
  }

  async updateProduct(
    buildingId: string,
    id: string,
    dto: {
      name?: string;
      priceCents?: number;
      stock?: number;
      imageKey?: string;
      active?: boolean;
    },
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    this.requireAdmin(user);
    const product = await this.prisma.product.findFirst({ where: { id, buildingId } });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.imageKey !== undefined ? { imageKey: dto.imageKey } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  async deleteProduct(buildingId: string, id: string, user: AuthenticatedUser): Promise<void> {
    assertSameBuilding(user, buildingId);
    this.requireAdmin(user);
    const product = await this.prisma.product.findFirst({ where: { id, buildingId } });
    if (!product) throw new NotFoundException('Product not found');
    await this.prisma.product.delete({ where: { id } });
  }

  /** Resident-facing catalog (active products only). */
  async catalog(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    return this.prisma.product.findMany({ where: { buildingId, active: true }, orderBy: { name: 'asc' } });
  }

  /**
   * Place an order: decrements stock optimistically (negative → 409), creating
   * a PENDING order. Payment settles separately (webhook) which flips PAID.
   */
  async order(
    buildingId: string,
    dto: { productId: string; qty: number; toInvoice?: boolean },
    user: AuthenticatedUser,
  ): Promise<ProductOrderView> {
    assertSameBuilding(user, buildingId);
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, buildingId, active: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (!Number.isInteger(dto.qty) || dto.qty <= 0) {
      throw new BadRequestException('qty must be a positive integer');
    }

    const unit = await this.firstOwnedUnit(buildingId, user.id);
    if (!unit) throw new ForbiddenException('You must own a unit in this building to order');

    // Optimistic stock check (racy but acceptable; DB upsert guards doubles later).
    if (product.stock < dto.qty) {
      throw new ConflictException('Insufficient stock');
    }

    const amountCents = product.priceCents * dto.qty;
    const order = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: { id: product.id, stock: { gte: dto.qty } },
        data: { stock: { decrement: dto.qty } },
      });
      if (updated.count === 0) {
        throw new ConflictException('Insufficient stock');
      }
      return tx.productOrder.create({
        data: {
          buildingId,
          unitId: unit.unitId,
          productId: product.id,
          qty: dto.qty,
          amountCents,
          status: 'PENDING',
        },
      });
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'shop.order.create',
      entity: 'product_order',
      entityId: order.id,
      metadata: { productId: product.id, qty: dto.qty, amountCents },
    });

    return this.orderViewFor(order.id);
  }

  /** Mark an order paid (called by the payment/webhook settlement path). */
  async markPaid(orderId: string, user?: AuthenticatedUser): Promise<void> {
    const order = await this.prisma.productOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    await this.prisma.productOrder.update({
      where: { id: orderId },
      data: { status: 'PAID' },
    });
  }

  /** Admin order list + resident order history. */
  async orders(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    if (this.isAdminLike(user)) {
      return this.prisma.productOrder.findMany({
        where: { buildingId },
        include: { unit: { select: { label: true } }, product: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }
    const unit = await this.firstOwnedUnit(buildingId, user.id);
    return this.prisma.productOrder.findMany({
      where: { buildingId, ...(unit ? { unitId: unit.unitId } : {}) },
      include: { unit: { select: { label: true } }, product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async orderViewFor(id: string): Promise<ProductOrderView> {
    const order = await this.prisma.productOrder.findUnique({
      where: { id },
      include: { unit: { select: { label: true } }, product: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      id: order.id,
      buildingId: order.buildingId,
      unitId: order.unitId,
      unitLabel: order.unit.label,
      productId: order.productId,
      productName: order.product.name,
      qty: order.qty,
      amountCents: order.amountCents,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private async firstOwnedUnit(buildingId: string, userId: string) {
    return this.prisma.ownership.findFirst({
      where: { userId, unit: { buildingId } },
      select: { unitId: true },
    });
  }

  private requireAdmin(user: AuthenticatedUser): void {
    if (!this.isAdminLike(user)) {
      throw new ForbiddenException('Admin access required');
    }
  }

  private isAdminLike(user: AuthenticatedUser): boolean {
    return user.role === Role.ADMIN || user.role === Role.BUILDING_OWNER;
  }

  private toProductView(row: {
    id: string;
    buildingId: string;
    name: string;
    priceCents: number;
    stock: number;
    imageKey: string | null;
    active: boolean;
  }): ProductView {
    return {
      id: row.id,
      buildingId: row.buildingId,
      name: row.name,
      priceCents: row.priceCents,
      stock: row.stock,
      imageKey: row.imageKey,
      active: row.active,
    };
  }
}