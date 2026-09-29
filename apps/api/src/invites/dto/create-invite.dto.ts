import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
