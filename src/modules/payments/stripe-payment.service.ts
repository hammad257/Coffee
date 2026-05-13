import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import DecimalPkg from 'decimal.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import Stripe from 'stripe';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StripePaymentService {
  private stripe: InstanceType<typeof Stripe> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private stripeClient(): InstanceType<typeof Stripe> {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'STRIPE_SECRET_KEY is not set; Stripe is disabled.',
      );
    }
    if (!this.stripe) {
      this.stripe = new Stripe(key);
    }
    return this.stripe;
  }

  getPublishableKey(): string | null {
    const k = this.config.get<string>('STRIPE_PUBLISH_KEY')?.trim();
    return k && k.length > 0 ? k : null;
  }

  /** https://stripe.com/docs/currencies#zero-decimal */
  private isZeroDecimalCurrency(currency: string): boolean {
    return new Set([
      'bif',
      'clp',
      'djf',
      'gnf',
      'jpy',
      'kmf',
      'krw',
      'mga',
      'pyg',
      'rwf',
      'ugx',
      'vnd',
      'vuv',
      'xaf',
      'xof',
      'xpf',
    ]).has(currency.toLowerCase());
  }

  /** Amount in smallest currency unit accepted by Stripe. */
  private orderAmountStripeUnit(total: unknown, currency: string): number {
    const d = new DecimalPkg(String(total));
    const unit = this.isZeroDecimalCurrency(currency)
      ? d.round()
      : d.times(100).round();
    const n = unit.toNumber();
    if (!Number.isFinite(n) || n < 1) {
      throw new BadRequestException('Invalid order total for Stripe.');
    }
    return n;
  }

  async createPaymentIntentForOrder(orderId: string) {
    const currency =
      this.config.get<string>('STRIPE_DEFAULT_CURRENCY')?.trim()?.toLowerCase() ||
      'usd';
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        total: true,
        paymentStatus: true,
        stripePaymentIntentId: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.CANCELLED
    ) {
      throw new ConflictException('Cannot charge a finalized order.');
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new ConflictException('Order is already paid.');
    }

    const amount = this.orderAmountStripeUnit(order.total, currency);
    const stripe = this.stripeClient();

    if (order.stripePaymentIntentId) {
      try {
        await stripe.paymentIntents.cancel(order.stripePaymentIntentId);
      } catch {
        // Ignore (already succeeded / not cancelable).
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: { orderId: order.id },
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: intent.id },
    });

    if (!intent.client_secret) {
      throw new ServiceUnavailableException(
        'Stripe did not return a client secret for this PaymentIntent.',
      );
    }

    return {
      orderId: order.id,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amount,
      currency,
      publishableKey: this.getPublishableKey(),
    };
  }

  /** Express lowercases header names; value may be string or string[]. */
  private getStripeSignature(req: RawBodyRequest<Request>): string | undefined {
    const h = req.headers;
    for (const [name, value] of Object.entries(h)) {
      if (name.toLowerCase() === 'stripe-signature') {
        if (typeof value === 'string') return value;
        if (Array.isArray(value) && value[0]) return value[0];
      }
    }
    return req.get('stripe-signature') ?? undefined;
  }

  async handleStripeWebhook(
    rawBodyReq: RawBodyRequest<Request>,
    signatureFromDecorator?: string,
  ) {
    const whSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!whSecret) {
      throw new ServiceUnavailableException(
        'STRIPE_WEBHOOK_SECRET is not set; cannot verify Stripe webhooks.',
      );
    }
    const signature =
      signatureFromDecorator?.trim() ||
      this.getStripeSignature(rawBodyReq);
    if (!signature) {
      throw new BadRequestException(
        'Missing Stripe-Signature header. If using Stripe CLI, use an explicit URL: `stripe listen --forward-to http://127.0.0.1:3000/api/v1/payments/stripe/webhook` then paste the printed `whsec_...` into STRIPE_WEBHOOK_SECRET. Avoid testing this route from the browser or Swagger (those requests have no signature).',
      );
    }
    const raw = rawBodyReq.rawBody;
    if (!Buffer.isBuffer(raw)) {
      throw new BadRequestException('Raw body unavailable for webhook verification.');
    }

    let event: ReturnType<
      InstanceType<typeof Stripe>['webhooks']['constructEvent']
    >;
    try {
      event = this.stripeClient().webhooks.constructEvent(
        raw,
        signature,
        whSecret,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid webhook';
      throw new BadRequestException(msg);
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as { id: string };
      await this.markOrderPaidFromIntent(pi.id);
      return { received: true, handled: 'payment_intent.succeeded' as const };
    }

    return { received: true, handled: null };
  }

  private async markOrderPaidFromIntent(paymentIntentId: string) {
    const stripe = this.stripeClient();
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.payment_method_details'],
    });

    let last4: string | null = null;
    const charge =
      pi.latest_charge && typeof pi.latest_charge === 'object'
        ? pi.latest_charge
        : null;
    if (charge) {
      last4 =
        charge.payment_method_details?.card?.last4 ??
        charge.payment_method_details?.card_present?.last4 ??
        null;
    } else if (typeof pi.latest_charge === 'string') {
      try {
        const ch = await stripe.charges.retrieve(pi.latest_charge);
        last4 =
          ch.payment_method_details?.card?.last4 ??
          ch.payment_method_details?.card_present?.last4 ??
          null;
      } catch {
        // Ignore optional enrichment failures.
      }
    }

    const metaOrderId = pi.metadata?.orderId;
    const whereClause =
      metaOrderId && metaOrderId.length > 0
        ? ({ id: metaOrderId, stripePaymentIntentId: paymentIntentId } as const)
        : ({ stripePaymentIntentId: paymentIntentId } as const);

    await this.prisma.order.updateMany({
      where: {
        ...whereClause,
        paymentStatus: { not: PaymentStatus.PAID },
      },
      data: {
        paymentStatus: PaymentStatus.PAID,
        paymentMethod: PaymentMethod.ONLINE,
        ...(last4 ? { paymentLast4: last4 } : {}),
      },
    });
  }
}
