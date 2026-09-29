import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Patch,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { routes } from '../security/throttle.config';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ShopService } from './shop.service';

class CreateProductDto {
  @IsString()
  name!: string;

  @IsInt()
  @IsPositive()
  priceCents!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  imageKey?: string;
}

class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  imageKey?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class OrderDto {
  @IsString()
  productId!: string;

  @IsInt()
  @IsPositive()
  qty!: number;

  @IsOptional()
  @IsString()
  paymentRef?: string;
}

const checkoutThrottle = {
  default: { limit: routes.checkout.limit, ttl: routes.checkout.ttlMs },
};

@Controller('buildings/:buildingId/shop')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('products')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  listProducts(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.listProducts(buildingId, user);
  }

  @Post('products')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  createProduct(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.createProduct(buildingId, dto, user);
  }

  @Patch('products/:id')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  updateProduct(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.updateProduct(buildingId, id, dto, user);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  deleteProduct(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.deleteProduct(buildingId, id, user);
  }

  @Get('catalog')
  @Roles(Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER)
  catalog(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.catalog(buildingId, user);
  }

  @Post('orders')
  @HttpCode(201)
  @Roles(Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER)
  @Throttle(checkoutThrottle)
  order(
    @Param('buildingId') buildingId: string,
    @Body() dto: OrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.order(buildingId, dto, user);
  }

  @Post('orders/:id/paid')
  @HttpCode(200)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  markPaid(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.markPaid(id, user);
  }

  @Get('orders')
  @Roles(Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER)
  orders(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shopService.orders(buildingId, user);
  }
}