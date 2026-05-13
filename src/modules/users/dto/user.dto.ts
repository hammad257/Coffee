import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  firstName: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  lastName: string;

  @ApiPropertyOptional({ description: 'Maps to stored photo URL when upload pipe exists.' })
  @IsString()
  @IsOptional()
  photoUploadId?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiProperty({ description: 'At least one role required', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  roleIds: string[];
}

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'roleIds'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(48)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  workLocation?: string | null;

  @ApiPropertyOptional({
    description: 'daily_digest | realtime | weekly | off',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  notificationFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(24)
  systemLanguage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;
}

export class UpdateUserPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;

  @ApiPropertyOptional({
    description: 'Required when changing your own password',
  })
  @IsString()
  @MinLength(8)
  @IsOptional()
  currentPassword?: string;
}

export class AssignUserRolesDto {
  @ApiProperty({
    type: [String],
    description: 'Full replacement; at least one role required',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  roleIds: string[];
}

// export class UpdateUserScopeDto {
//   @ApiProperty({ type: [String] })
//   @IsArray()
//   @IsUUID('4', { each: true })
//   campusIds: string[];

//   @ApiProperty({ type: [String] })
//   @IsArray()
//   @IsUUID('4', { each: true })
//   departmentIds: string[];
// }

export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  roleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
