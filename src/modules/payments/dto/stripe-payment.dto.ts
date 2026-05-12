import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateStripePaymentIntentBodyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId: string;
}
