import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { MARKET_CODES } from '@org/shared';

const PSP_PROVIDERS = ['viva', 'stripejp', 'stripe', 'mercadopago', 'gmo'] as const;
const CURRENCIES = ['EUR', 'USD', 'CAD', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'GBP', 'PLN', 'SEK', 'CZK'] as const;

export class UpdateBuildingSettingsDto {
  /**
   * Japan 適格請求書 registration number: `T` followed by 13 digits.
   * e.g. `T1234567890123`.
   */
  @IsOptional()
  @IsString()
  @Matches(/^T[0-9]{13}$/, {
    message: 'invoiceRegistrationNo must match T + 13 digits (e.g. T1234567890123)',
  })
  invoiceRegistrationNo?: string;

  @IsOptional()
  @IsIn([...MARKET_CODES])
  market?: string;

  @IsOptional()
  @IsIn([...CURRENCIES])
  currency?: string;

  @IsOptional()
  @IsIn([...PSP_PROVIDERS])
  pspProvider?: string;
}