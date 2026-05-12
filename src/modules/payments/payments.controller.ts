import {
  Body,
  Controller,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CreateStripePaymentIntentBodyDto } from './dto/stripe-payment.dto';
import { StripePaymentService } from './stripe-payment.service';

@ApiTags('Payments — Stripe')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly stripePayments: StripePaymentService) {}

  @Public()
  @Get('stripe/config')
  @ApiOperation({
    summary:
      'Public publishable key for Stripe.js / mobile SDK (omit if unset in env)',
  })
  stripeClientConfig() {
    return {
      publishableKey: this.stripePayments.getPublishableKey(),
    };
  }

  @Post('stripe/order-intent')
  @Permissions('coffee.order.update')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Create Stripe PaymentIntent for an order total (currency from STRIPE_DEFAULT_CURRENCY)',
  })
  createOrderPaymentIntent(@Body() body: CreateStripePaymentIntentBodyDto) {
    return this.stripePayments.createPaymentIntentForOrder(body.orderId);
  }

  @Public()
  @Post('stripe/webhook')
  @ApiOperation({
    summary:
      'Stripe webhook — verify STRIPE_WEBHOOK_SECRET signature; confirms payment_intent.succeeded',
  })
  stripeWebhook(@Req() req: RawBodyRequest<Request>) {
    return this.stripePayments.handleStripeWebhook(req);
  }
}
