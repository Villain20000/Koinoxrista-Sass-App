import { IsOptional, IsString } from 'class-validator';

export class WebhookDto {
  @IsString()
  orderCode!: string;

  @IsOptional()
  @IsString()
  transactionId?: string;
}
