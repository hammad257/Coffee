import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';


export class LoginDto {
  @ApiProperty({ example: 'admin@coffee-shop.local' })
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({ example:'ChangeMe!2026', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  refreshToken: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'If set, revoke only this refresh token. If omitted, revoke all sessions and invalidate access JWTs.',
  })
  @IsString()
  @IsOptional()
  refreshToken?: string;
}
