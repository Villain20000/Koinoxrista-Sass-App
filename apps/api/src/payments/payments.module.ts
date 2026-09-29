import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ArrearsController } from './arrears.controller';
import { ArrearsService } from './arrears.service';
import {
  PaymentsController,
  PaymentsWebhookController,
  StripeWebhookController,
  MercadoPagoWebhookController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { createVivaAdapter, VIVA_ADAPTER } from './viva.adapter';
import { createStripeJpAdapter, STRIPE_JP_ADAPTER } from './stripejp.adapter';
import { createStripeAdapter, STRIPE_ADAPTER } from './stripe.adapter';
import {
  createMercadoPagoAdapter,
  MERCADOPAGO_ADAPTER,
} from './mercadopago.adapter';

@Module({
  imports: [AuditModule],
  controllers: [
    PaymentsController,
    PaymentsWebhookController,
    StripeWebhookController,
    MercadoPagoWebhookController,
    ArrearsController,
  ],
  providers: [
    PaymentsService,
    ArrearsService,
    { provide: VIVA_ADAPTER, useFactory: createVivaAdapter },
    {
      provide: STRIPE_JP_ADAPTER,
      useFactory: () => {
        const secret = process.env.STRIPE_SECRET_KEY;
        return secret ? createStripeJpAdapter() : undefined;
      },
    },
    {
      provide: STRIPE_ADAPTER,
      useFactory: () => {
        const secret = process.env.STRIPE_SECRET_KEY;
        return secret ? createStripeAdapter() : undefined;
      },
    },
    {
      provide: MERCADOPAGO_ADAPTER,
      useFactory: createMercadoPagoAdapter,
    },
  ],
  exports: [ArrearsService],
})
export class PaymentsModule {}
