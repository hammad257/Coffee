import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { FulfillmentMethod, OrderType } from '@prisma/client';

export class RecentOrdersQueryDto {
  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ enum: OrderType })
  @IsOptional()
  @IsEnum(OrderType)
  type?: OrderType;

  @ApiPropertyOptional({
    enum: FulfillmentMethod,
    description:
      'e.g. COUNTER_PICKUP on takeaway dashboards, DELIVERY for online lane',
  })
  @IsOptional()
  @IsEnum(FulfillmentMethod)
  fulfillment?: FulfillmentMethod;

  @ApiPropertyOptional({
    description:
      'Kitchen / pipeline lane only (excludes COMPLETED & CANCELLED). Accepts true or "true"',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return undefined;
  })
  @IsBoolean()
  activeOnly?: boolean;
}
