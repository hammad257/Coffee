import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** POS roles exposed on self-service signup (must exist in `roles` table). */
export enum SignupRoleCode {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  BARISTA = 'BARISTA',
  CASHIER = 'CASHIER',
}

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

export class SignupDto {
  @ApiProperty({ example: 'newuser@coffee-shop.local' })
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({ example: 'SecurePass!2026', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Alex' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  firstName: string;

  @ApiProperty({ example: 'Rivera' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lastName: string;

  @ApiProperty({ enum: SignupRoleCode, example: SignupRoleCode.BARISTA })
  @IsEnum(SignupRoleCode)
  roleCode: SignupRoleCode;

  @ApiPropertyOptional({
    description: 'Only used when account is ACTIVE immediately after signup',
  })
  @IsOptional()
  @IsBoolean()
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
