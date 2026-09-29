export type SupplierInvoiceStatus = 'DRAFT' | 'IMPORTED' | 'MATCHED' | 'VOIDED';

export const SUPPLIER_INVOICE_STATUSES: SupplierInvoiceStatus[] = [
  'DRAFT',
  'IMPORTED',
  'MATCHED',
  'VOIDED',
];

export interface SupplierInvoiceDto {
  id: string;
  buildingId: string;
  issuerName: string;
  issuerAfm?: string | null;
  issueDate: string;
  netCents: number;
  vatCents: number;
  totalCents: number;
  currency: string;
  mydataMark?: string | null;
  classification?: string | null;
  status: SupplierInvoiceStatus;
  rawJson?: unknown;
  pdfUrl?: string | null;
  expenseId?: string | null;
  createdAt: string;
}

export interface CreateManualSupplierInvoiceDto {
  issuerName: string;
  issuerAfm?: string;
  issueDate: string;
  netCents: number;
  vatCents: number;
  totalCents: number;
  currency?: string;
  classification?: string;
  pdfUrl?: string;
}

export interface ImportSupplierJsonDto {
  json?: Record<string, unknown> | string;
  [key: string]: unknown;
}

export interface MatchSupplierInvoiceDto {
  expenseId?: string;
}

export interface SupplierInvoiceListQueryDto {
  status?: SupplierInvoiceStatus;
  from?: string;
  to?: string;
  skip?: number;
  take?: number;
}

export interface SupplierInvoiceListResponseDto {
  items: SupplierInvoiceDto[];
  total: number;
  skip: number;
  take: number;
}

export interface SupplierInvoiceStatsDto {
  totalCount: number;
  draftCount: number;
  importedCount: number;
  matchedCount: number;
  voidedCount: number;
  countByStatus: Record<SupplierInvoiceStatus, number>;
  totals: {
    netCents: number;
    vatCents: number;
    totalCents: number;
  };
  vatSummary: {
    totalNetCents: number;
    totalVatCents: number;
    totalGrossCents: number;
    byClassification: Record<string, { netCents: number; vatCents: number; totalCents: number; count: number }>;
  };
  monthly: Array<{
    month: string;
    netCents: number;
    vatCents: number;
    totalCents: number;
    count: number;
  }>;
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
}

export interface PullMyDataResponseDto {
  imported: number;
  skipped: number;
  total: number;
}

export interface OcrExtractResponseDto {
  issuerName: string | null;
  issuerAfm: string | null;
  issueDate: string | null;
  netCents: number | null;
  vatCents: number | null;
  totalCents: number | null;
  confidence: number;
  rawText: string;
}
