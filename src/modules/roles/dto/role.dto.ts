import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'LIBRARIAN', description: 'UPPER_SNAKE_CASE' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/, {
    message: 'code must be UPPER_SNAKE_CASE',
  })
  @MaxLength(50)
  code: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID('4', { each: true })
  permissionIds: string[];
}
