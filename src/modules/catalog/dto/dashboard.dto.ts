import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export type DashboardSalesPeriod = 'today' | 'week' | 'month';

export class TopSellingProductsQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month'], default: 'month' })
  @IsOptional()
  @IsEnum(['today', 'week', 'month'])
  period?: DashboardSalesPeriod;

  @ApiPropertyOptional({ default: 5, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class StockAlertsQueryDto {
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
