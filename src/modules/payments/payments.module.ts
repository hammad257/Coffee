import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { StripePaymentService } from './stripe-payment.service';

@Module({
  controllers: [PaymentsController],
  providers: [StripePaymentService],
})
export class PaymentsModule {}
