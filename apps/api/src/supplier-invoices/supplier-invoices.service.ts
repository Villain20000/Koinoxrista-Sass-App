import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { splitByLargestRemainder } from '../prisma/split-by-largest-remainder';
import { OcrService } from './ocr.service';
import { MyDataPullService } from './mydata-pull.service';
import type { CreateManualSupplierInvoiceDto } from './dto/create-manual.dto';

const STATUSES = ['DRAFT', 'IMPORTED', 'MATCHED', 'VOIDED'] as const;
type SupplierStatus = (typeof STATUSES)[number];

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

function assertValidStatus(status?: string): SupplierStatus | undefined {
  if (status === undefined || status === '' || status === null) return undefined;
  if (!STATUSES.includes(status as SupplierStatus)) {
    throw new BadRequestException(`Invalid status: ${status}. Allowed: ${STATUSES.join(', ')}`);
  }
  return status as SupplierStatus;
}

function parseDateOrThrow(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid date for ${field}: ${value}`);
  }
  return d;
}

function centsFromUnknown(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Heuristic: if value is float with decimals, treat as euros -> cents
    // If value is integer and > 100000 maybe already cents? But we treat integer as cents if it is whole
    // However JSON often gives euros like 100.00 (float) => cents 10000
    // To disambiguate: if number is integer and string representation has no dot, assume cents
    // But if integer is large like 12400 (cents for 124 EUR) vs 124 (euros) ambiguous.
    // We'll assume: if number %1 !==0 => euros fractional => *100
    // else assume cents if value >= 100 (most invoices) -> but spec gives cents, so integer => cents
    if (!Number.isInteger(value)) {
      return Math.round(value * 100);
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Remove currency symbols and spaces
    const cleaned = trimmed.replace(/[€EURευρώ\s]/gi, '').trim();
    if (!cleaned) return null;
    // Try to detect decimal comma vs dot
    // If contains both, last is decimal
    let s = cleaned;
    // Strip thousands separators like ' or space already removed
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    let decimalSep: string | null = null;
    if (lastDot !== -1 && lastComma !== -1) {
      decimalSep = lastDot > lastComma ? '.' : ',';
    } else if (lastComma !== -1) {
      const after = s.slice(lastComma + 1);
      decimalSep = after.length === 2 ? ',' : null;
    } else if (lastDot !== -1) {
      const after = s.slice(lastDot + 1);
      decimalSep = after.length === 2 ? '.' : null;
    }
    if (decimalSep === ',') {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (decimalSep === '.') {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/[.,]/g, '');
      const intVal = Number(s);
      if (!Number.isFinite(intVal)) return null;
      // No decimal -> treat as euros? But input like "124" without decimal might be euros -> *100
      // However many myDATA JSON give netValue as "100.00" with decimal, so this branch rarely hit
      // For safety, if string had no decimal separator, treat as cents if it looks like cents (e.g., "12400")
      // We assume integer string without decimal is cents if length > 2? ambiguous. Prefer euros -> cents
      // We'll treat as cents if number is integer and we can't determine, to preserve manual cents
      // Check original string had decimal pattern originally? Since we stripped, we lost it. So treat as euros if len<=3?
      // For now treat as integer euros -> cents *100 if small, else cents.
      // Heuristic: if original trimmed contained '.' or ',' we already handled. If not, it's plain integer.
      // Plain integer likely represents cents when coming from form (user sends ints). So return as is.
      return intVal;
    }
    const num = Number(s);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 100);
  }
  return null;
}

function getByPaths(obj: any, paths: string[]): unknown {
  for (const p of paths) {
    const parts = p.split('.');
    let cur: any = obj;
    let found = true;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) {
        cur = cur[part];
      } else {
        found = false;
        break;
      }
    }
    if (found && cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

function extractMyDataFields(json: any) {
  if (!json || typeof json !== 'object') {
    throw new BadRequestException('Invalid JSON payload');
  }

  // Unwrap common myDATA envelopes
  let payload: any = json;
  // Handle { json: {...} } wrapper from frontend import-json
  if (payload.json && typeof payload.json === 'object') {
    // if top-level also has other keys, prefer inner json if it looks like invoice
    const inner = payload.json;
    // If inner is string, try parse
    if (typeof inner === 'string') {
      try {
        payload = JSON.parse(inner);
      } catch {
        throw new BadRequestException('Invalid JSON string in json field');
      }
    } else {
      payload = inner;
    }
  } else if (payload.json && typeof payload.json === 'string') {
    try {
      payload = JSON.parse(payload.json as string);
    } catch {
      throw new BadRequestException('Invalid JSON string in json field');
    }
  }

  // Some myDATA docs nest under InvoicesDoc / invoice / invoices
  if (payload.InvoicesDoc && payload.InvoicesDoc.invoice) {
    payload = Array.isArray(payload.InvoicesDoc.invoice)
      ? payload.InvoicesDoc.invoice[0]
      : payload.InvoicesDoc.invoice;
  }
  if (payload.invoice && typeof payload.invoice === 'object' && !payload.issuerName) {
    payload = payload.invoice;
  }

  const issuerName =
    getByPaths(payload, [
      'issuerName',
      'issuer.name',
      'issuerName.gr',
      'supplierName',
      'counterpartName',
      'name',
      'issuerName.value',
      'partyName',
      'seller.name',
      'issuer.Name',
    ]) ?? getByPaths(payload, ['issuer', 'supplier']) // fallback if issuer is string
  ;

  const issuerAfm =
    getByPaths(payload, [
      'issuerAfm',
      'issuerVat',
      'issuerVatNumber',
      'vatNumber',
      'issuer.vatNumber',
      'issuer.afm',
      'counterpartVatNumber',
      'afm',
      'seller.vat',
    ]);

  const issueDateRaw =
    getByPaths(payload, [
      'issueDate',
      'invoiceDate',
      'date',
      'issuanceDate',
      'issueDateTime',
      'invoiceDetails.issueDate',
      'header.issueDate',
    ]);

  // Separate cents vs euros key sets to avoid ambiguous numeric conversion
  const NET_CENTS_KEYS = ['netCents', 'netAmountCents', 'netValueCents'];
  const NET_EUROS_KEYS = [
    'netValue',
    'invoiceDetails.netValue',
    'netAmount',
    'totalNetValue',
    'amountNet',
    'net',
    'netAmountCents.value',
  ];
  const VAT_CENTS_KEYS = ['vatCents', 'vatAmountCents'];
  const VAT_EUROS_KEYS = ['vatAmount', 'invoiceDetails.vatAmount', 'vat', 'totalVatAmount', 'vatValue'];
  const TOTAL_CENTS_KEYS = ['totalCents', 'grossCents'];
  const TOTAL_EUROS_KEYS = [
    'totalValue',
    'grossValue',
    'totalAmount',
    'invoiceDetails.total',
    'payableAmount',
    'gross',
    'amount',
    'total',
  ];

  function centsFromCentsField(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      if (!Number.isInteger(value)) return Math.round(value * 100);
      return value;
    }
    return centsFromUnknown(value);
  }

  function centsFromEurosField(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return Math.round(value * 100);
    }
    return centsFromUnknown(value);
  }

  // Try cents fields first, fallback to euros fields
  let netRaw: unknown = getByPaths(payload, NET_CENTS_KEYS);
  let netIsCents = netRaw !== undefined;
  if (netRaw === undefined) {
    netRaw = getByPaths(payload, NET_EUROS_KEYS);
    netIsCents = false;
  }
  let vatRaw: unknown = getByPaths(payload, VAT_CENTS_KEYS);
  let vatIsCents = vatRaw !== undefined;
  if (vatRaw === undefined) {
    vatRaw = getByPaths(payload, VAT_EUROS_KEYS);
    vatIsCents = false;
  }
  let totalRaw: unknown = getByPaths(payload, TOTAL_CENTS_KEYS);
  let totalIsCents = totalRaw !== undefined;
  if (totalRaw === undefined) {
    totalRaw = getByPaths(payload, TOTAL_EUROS_KEYS);
    totalIsCents = false;
  }

  const markRaw =
    getByPaths(payload, [
      'mydataMark',
      'myDataMark',
      'mark',
      'markNumber',
      'myDATA.mark',
      'MARK',
      'uid',
      'invoiceMark',
    ]);

  const classificationRaw =
    getByPaths(payload, [
      'classification',
      'category',
      'classificationCategory',
      'classificationType',
      'invoiceDetails.classificationCategory',
      'cat',
    ]);

  const currencyRaw = getByPaths(payload, ['currency', 'cur']);

  // Normalize
  let issuerNameStr: string | undefined =
    typeof issuerName === 'string' ? issuerName.trim() : issuerName != null ? String(issuerName).trim() : undefined;
  if (!issuerNameStr) {
    // Try to derive from issuer object if it's a string
    if (typeof payload.issuer === 'string') issuerNameStr = payload.issuer.trim();
  }

  let issuerAfmStr: string | undefined =
    issuerAfm != null ? String(issuerAfm).replace(/\D/g, '').trim() : undefined;
  if (issuerAfmStr && !/^\d{9}$/.test(issuerAfmStr)) {
    // If AFM has extra chars, try to extract 9 digits
    const m = issuerAfmStr.match(/(\d{9})/);
    issuerAfmStr = m ? m[1] : undefined;
    if (issuerAfmStr && issuerAfmStr.length !== 9) issuerAfmStr = undefined;
  }
  if (issuerAfmStr === '') issuerAfmStr = undefined;

  let issueDateStr: string | undefined =
    typeof issueDateRaw === 'string' ? issueDateRaw.trim() : issueDateRaw ? String(issueDateRaw).trim() : undefined;

  // Try to coerce issueDate if it's a Date object or timestamp
  if (issueDateRaw instanceof Date) {
    issueDateStr = issueDateRaw.toISOString().slice(0, 10);
  }

  const netCents = netRaw !== undefined ? (netIsCents ? centsFromCentsField(netRaw) : centsFromEurosField(netRaw)) : null;
  const vatCents = vatRaw !== undefined ? (vatIsCents ? centsFromCentsField(vatRaw) : centsFromEurosField(vatRaw)) : null;
  const totalCents = totalRaw !== undefined ? (totalIsCents ? centsFromCentsField(totalRaw) : centsFromEurosField(totalRaw)) : null;

  let mydataMarkStr: string | undefined =
    markRaw != null ? String(markRaw).trim() : undefined;
  if (mydataMarkStr === '') mydataMarkStr = undefined;

  let classificationStr: string | undefined =
    classificationRaw != null ? String(classificationRaw).trim() : undefined;
  if (classificationStr === '') classificationStr = undefined;

  let currencyStr = typeof currencyRaw === 'string' ? currencyRaw.trim().toUpperCase() : 'EUR';
  if (!currencyStr) currencyStr = 'EUR';

  return {
    issuerName: issuerNameStr,
    issuerAfm: issuerAfmStr,
    issueDate: issueDateStr,
    netCents,
    vatCents,
    totalCents,
    mydataMark: mydataMarkStr,
    classification: classificationStr,
    currency: currencyStr,
    payload,
  };
}

function toDto(row: any) {
  return {
    id: row.id,
    buildingId: row.buildingId,
    issuerName: row.issuerName,
    issuerAfm: row.issuerAfm ?? null,
    issueDate: row.issueDate instanceof Date ? row.issueDate.toISOString() : String(row.issueDate),
    netCents: row.netCents,
    vatCents: row.vatCents,
    totalCents: row.totalCents,
    currency: row.currency ?? 'EUR',
    mydataMark: row.mydataMark ?? null,
    classification: row.classification ?? null,
    status: row.status,
    rawJson: row.rawJson ?? null,
    pdfUrl: row.pdfUrl ?? null,
    expenseId: row.expenseId ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ocr: OcrService,
    private readonly mydataPull: MyDataPullService,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // List with pagination and filters
  // ─────────────────────────────────────────────────────────────────
  async list(
    buildingId: string,
    query: {
      status?: string;
      from?: string;
      to?: string;
      skip?: string | number;
      take?: string | number;
      page?: string | number;
      limit?: string | number;
    } = {},
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const status = assertValidStatus(query.status);
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (query.from) fromDate = parseDateOrThrow(query.from, 'from');
    if (query.to) toDate = parseDateOrThrow(query.to, 'to');
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from must be before to');
    }

    // pagination: support skip/take or page/limit
    let skip: number;
    let take: number;
    if (query.page !== undefined || query.limit !== undefined) {
      const page = Math.max(Number(query.page ?? 1) || 1, 1);
      const limit = Math.min(Math.max(Number(query.limit ?? query.take ?? DEFAULT_TAKE) || DEFAULT_TAKE, 1), MAX_TAKE);
      take = limit;
      skip = (page - 1) * take;
    } else {
      take = Math.min(Math.max(Number(query.take ?? DEFAULT_TAKE) || DEFAULT_TAKE, 1), MAX_TAKE);
      skip = Math.max(Number(query.skip ?? 0) || 0, 0);
    }

    const where: any = { buildingId };
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.issueDate = {};
      if (fromDate) where.issueDate.gte = fromDate;
      if (toDate) where.issueDate.lte = toDate;
    }

    const prismaAny = this.prisma as any;
    const [items, total] = await prismaAny.$transaction([
      prismaAny.supplierInvoice.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: { expense: { select: { id: true } } },
      }),
      prismaAny.supplierInvoice.count({ where }),
    ]);

    return {
      items: items.map(toDto),
      total,
      skip,
      take,
    };
  }

  async getById(buildingId: string, id: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const row = await (this.prisma as any).supplierInvoice.findFirst({
      where: { id, buildingId },
      include: { expense: { select: { id: true, description: true, totalCents: true } } },
    });
    if (!row) throw new NotFoundException('Supplier invoice not found');
    return toDto(row);
  }

  async importManual(
    buildingId: string,
    dto: CreateManualSupplierInvoiceDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const issueDate = parseDateOrThrow(dto.issueDate, 'issueDate');
    if (!Number.isInteger(dto.netCents) || dto.netCents < 0) {
      throw new BadRequestException('netCents must be integer >=0');
    }
    if (!Number.isInteger(dto.vatCents) || dto.vatCents < 0) {
      throw new BadRequestException('vatCents must be integer >=0');
    }
    if (!Number.isInteger(dto.totalCents) || dto.totalCents <= 0) {
      throw new BadRequestException('totalCents must be integer >0');
    }
    if (dto.netCents + dto.vatCents !== dto.totalCents) {
      throw new BadRequestException('totalCents must equal netCents + vatCents');
    }

    const prismaAny = this.prisma as any;
    const created = await prismaAny.supplierInvoice.create({
      data: {
        buildingId,
        issuerName: dto.issuerName.trim(),
        ...(dto.issuerAfm ? { issuerAfm: dto.issuerAfm.trim() } : {}),
        issueDate,
        netCents: dto.netCents,
        vatCents: dto.vatCents,
        totalCents: dto.totalCents,
        currency: dto.currency?.trim() || 'EUR',
        ...(dto.classification ? { classification: dto.classification.trim() } : {}),
        status: 'DRAFT',
        ...(dto.pdfUrl ? { pdfUrl: dto.pdfUrl } : {}),
      },
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'supplier_invoice.manual_created',
      entity: 'supplier_invoice',
      entityId: created.id,
      metadata: { issuerName: created.issuerName, totalCents: created.totalCents },
    });

    return toDto(created);
  }

  async importFromJson(
    buildingId: string,
    body: Record<string, unknown>,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('JSON body is required');
    }

    const extracted = extractMyDataFields(body);

    if (!extracted.issuerName) {
      throw new BadRequestException('issuerName is required in myDATA JSON');
    }
    if (!extracted.issueDate) {
      throw new BadRequestException('issueDate is required in myDATA JSON');
    }
    const issueDate = parseDateOrThrow(extracted.issueDate, 'issueDate');

    let netCents = extracted.netCents;
    let vatCents = extracted.vatCents;
    let totalCents = extracted.totalCents;

    // Derive missing amounts: if total missing but net+vat present => total = sum
    if (totalCents == null && netCents != null && vatCents != null) {
      totalCents = netCents + vatCents;
    }
    // if net missing but total and vat present => net = total - vat
    if (netCents == null && totalCents != null && vatCents != null) {
      netCents = totalCents - vatCents;
    }
    if (vatCents == null && totalCents != null && netCents != null) {
      vatCents = totalCents - netCents;
    }
    // if only total present, estimate net/vat split 24% VAT
    if (netCents == null && vatCents == null && totalCents != null) {
      netCents = Math.round(totalCents / 1.24);
      vatCents = totalCents - netCents;
    }

    if (netCents == null || vatCents == null || totalCents == null) {
      throw new BadRequestException('netCents, vatCents and totalCents are required (or derivable) in myDATA JSON');
    }
    if (netCents + vatCents !== totalCents) {
      // Allow 1-2 cents rounding
      const diff = totalCents - (netCents + vatCents);
      if (Math.abs(diff) <= 2) {
        // adjust vat to make sum match
        vatCents += diff;
      } else {
        throw new BadRequestException('totalCents must equal netCents + vatCents (within 2 cents rounding)');
      }
    }

    const prismaAny = this.prisma as any;

    // Dedupe by mydataMark if present
    if (extracted.mydataMark) {
      const existing = await prismaAny.supplierInvoice.findFirst({
        where: { mydataMark: extracted.mydataMark },
      });
      if (existing) {
        // If belongs to another building, still conflict globally due to unique constraint
        if (existing.buildingId !== buildingId) {
          throw new ConflictException('mydataMark already exists for another building');
        }
        // Return existing without creating duplicate (idempotent)
        return toDto(existing);
      }
    }

    try {
      const created = await prismaAny.supplierInvoice.create({
        data: {
          buildingId,
          issuerName: extracted.issuerName,
          ...(extracted.issuerAfm ? { issuerAfm: extracted.issuerAfm } : {}),
          issueDate,
          netCents,
          vatCents,
          totalCents,
          currency: extracted.currency,
          ...(extracted.mydataMark ? { mydataMark: extracted.mydataMark } : {}),
          ...(extracted.classification ? { classification: extracted.classification } : {}),
          status: 'IMPORTED',
          rawJson: (body as any).json ?? body,
        },
      });

      this.audit.record({
        buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'supplier_invoice.imported_json',
        entity: 'supplier_invoice',
        entityId: created.id,
        metadata: { issuerName: created.issuerName, mydataMark: created.mydataMark ?? null },
      });

      return toDto(created);
    } catch (e) {
      if (isUniqueConflict(e)) {
        throw new ConflictException('Supplier invoice with same mydataMark already exists');
      }
      throw e;
    }
  }

  async importFromPdf(
    buildingId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('PDF file is required');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File exceeds 10MB');
    }

    const ocr = await this.ocr.extractFromBuffer(file.buffer, file.originalname);

    // Fallback defaults when OCR misses
    const issuerName = ocr.issuerName?.trim() || 'Άγνωστος Προμηθευτής';
    const issuerAfm = ocr.issuerAfm ?? null;
    const issueDate = ocr.issueDate ? new Date(ocr.issueDate) : new Date();
    let netCents = ocr.netCents;
    let vatCents = ocr.vatCents;
    let totalCents = ocr.totalCents;

    // Derive missing amounts similarly to JSON
    if (totalCents == null && netCents != null && vatCents != null) totalCents = netCents + vatCents;
    if (netCents == null && totalCents != null && vatCents != null) netCents = totalCents - vatCents;
    if (vatCents == null && totalCents != null && netCents != null) vatCents = totalCents - netCents;
    if (totalCents == null) {
      throw new BadRequestException('OCR could not detect total amount (€)');
    }
    if (netCents == null) {
      netCents = Math.round(totalCents / 1.24);
      vatCents = totalCents - netCents;
    }
    if (vatCents == null) vatCents = totalCents - netCents;

    if (netCents + vatCents !== totalCents) {
      const diff = totalCents - (netCents + vatCents);
      if (Math.abs(diff) <= 2) vatCents += diff;
    }

    const prismaAny = this.prisma as any;

    // Store PDF reference — simple key, not requiring storage service for stub
    const pdfUrl = `supplier-invoices/${buildingId}/${Date.now()}-${file.originalname}`;

    // Try to store file if storage service is available via prisma? We skip storage but keep url.

    const created = await prismaAny.supplierInvoice.create({
      data: {
        buildingId,
        issuerName,
        ...(issuerAfm ? { issuerAfm } : {}),
        issueDate,
        netCents,
        vatCents: vatCents ?? 0,
        totalCents,
        currency: ocr.currency || 'EUR',
        status: 'DRAFT',
        rawJson: {
          ocrConfidence: ocr.confidence,
          ocrAmounts: ocr.amounts,
          ocrRawText: ocr.rawText.slice(0, 2000),
        },
        pdfUrl,
      },
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'supplier_invoice.imported_pdf',
      entity: 'supplier_invoice',
      entityId: created.id,
      metadata: { confidence: ocr.confidence, totalCents },
    });

    // Append confidence to response via rawJson for frontend display
    const dto = toDto(created);
    (dto as any).ocrConfidence = ocr.confidence;
    return dto;
  }

  async pullFromMyData(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const external = await this.mydataPull.pullForBuilding(buildingId);
    const prismaAny = this.prisma as any;
    let imported = 0;
    let skipped = 0;

    for (const inv of external) {
      if (inv.mydataMark) {
        const existing = await prismaAny.supplierInvoice.findFirst({
          where: { mydataMark: inv.mydataMark },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
      }

      // Validate amounts sum
      if (inv.netCents + inv.vatCents !== inv.totalCents) {
        // auto-correct vat within 2 cents
        const diff = inv.totalCents - (inv.netCents + inv.vatCents);
        if (Math.abs(diff) <= 2) {
          inv.vatCents += diff;
        }
      }

      try {
        await prismaAny.supplierInvoice.create({
          data: {
            buildingId,
            issuerName: inv.issuerName,
            ...(inv.issuerAfm ? { issuerAfm: inv.issuerAfm } : {}),
            issueDate: new Date(inv.issueDate),
            netCents: inv.netCents,
            vatCents: inv.vatCents,
            totalCents: inv.totalCents,
            currency: inv.currency || 'EUR',
            mydataMark: inv.mydataMark,
            ...(inv.classification ? { classification: inv.classification } : {}),
            status: 'IMPORTED',
            rawJson: inv.rawJson ?? inv,
          },
        });
        imported += 1;
      } catch (e) {
        if (isUniqueConflict(e)) {
          skipped += 1;
        } else {
          throw e;
        }
      }
    }

    if (imported > 0 || skipped > 0) {
      this.audit.record({
        buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'supplier_invoice.pull_mydata',
        entity: 'supplier_invoice',
        entityId: null,
        metadata: { imported, skipped, total: external.length },
      });
    }

    return { imported, skipped, total: external.length };
  }

  async matchToExpense(
    buildingId: string,
    invoiceId: string,
    expenseId: string | undefined,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as any;

    const invoice = await prismaAny.supplierInvoice.findFirst({
      where: { id: invoiceId, buildingId },
    });
    if (!invoice) throw new NotFoundException('Supplier invoice not found');
    if (invoice.status === 'VOIDED') {
      throw new BadRequestException('Cannot match a voided invoice');
    }
    if (invoice.status === 'MATCHED') {
      throw new BadRequestException('Invoice already matched');
    }
    if (invoice.expenseId) {
      throw new BadRequestException('Invoice already linked to an expense');
    }

    if (expenseId) {
      const expense = await prismaAny.expense.findFirst({
        where: { id: expenseId, buildingId },
      });
      if (!expense) throw new NotFoundException('Expense not found for this building');

      const updated = await prismaAny.supplierInvoice.update({
        where: { id: invoiceId },
        data: { expenseId: expense.id, status: 'MATCHED' },
      });

      this.audit.record({
        buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'supplier_invoice.matched',
        entity: 'supplier_invoice',
        entityId: updated.id,
        metadata: { expenseId: expense.id, mode: 'link_existing' },
      });

      return toDto(updated);
    }

    // Auto-create expense from invoice
    const units = await prismaAny.unit.findMany({
      where: { buildingId },
      orderBy: { label: 'asc' },
    });
    if (units.length === 0) {
      throw new BadRequestException('Building has no units to allocate to');
    }

    // Resolve category: first existing or create default
    let category = await prismaAny.expenseCategory.findFirst({
      where: { buildingId },
    });
    if (!category) {
      // Create a generic category for supplier invoices
      category = await prismaAny.expenseCategory.create({
        data: {
          buildingId,
          name: 'Προμήθειες',
          strategy: 'MILIMES',
        },
      });
    }

    // Build weights for largest-remainder (use millimes or equal if missing)
    const weights = units.map((u: any) => ({
      id: u.id,
      weight: typeof u.millimes === 'number' && u.millimes > 0 ? u.millimes : 1,
    }));

    const splits = splitByLargestRemainder(invoice.totalCents, weights);

    const periodYearMonth = `${new Date(invoice.issueDate).getUTCFullYear()}-${String(new Date(invoice.issueDate).getUTCMonth() + 1).padStart(2, '0')}`;
    const description = `${invoice.issuerName} — ${invoice.classification ?? 'Προμήθεια'} ${periodYearMonth}`;

    // Transaction: create expense + shares + link invoice
    const result = await (prismaAny.$transaction as any)(async (tx: any) => {
      const expense = await tx.expense.create({
        data: {
          buildingId,
          categoryId: category.id,
          description,
          totalCents: invoice.totalCents,
          periodYearMonth,
          createdById: user.id,
        },
      });

      await tx.share.createMany({
        data: splits.map((s) => ({
          expenseId: expense.id,
          unitId: s.id,
          amountCents: s.amountCents,
        })),
      });

      const updatedInvoice = await tx.supplierInvoice.update({
        where: { id: invoiceId },
        data: { expenseId: expense.id, status: 'MATCHED' },
      });

      return { expense, updatedInvoice };
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'supplier_invoice.matched',
      entity: 'supplier_invoice',
      entityId: result.updatedInvoice.id,
      metadata: {
        expenseId: result.expense.id,
        mode: 'auto_created',
        totalCents: invoice.totalCents,
        periodYearMonth,
      },
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'expense.created',
      entity: 'expense',
      entityId: result.expense.id,
      metadata: {
        totalCents: invoice.totalCents,
        periodYearMonth,
        via: 'supplier_invoice',
        invoiceId,
      },
    });

    return toDto(result.updatedInvoice);
  }

  async voidInvoice(buildingId: string, invoiceId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as any;
    const invoice = await prismaAny.supplierInvoice.findFirst({
      where: { id: invoiceId, buildingId },
    });
    if (!invoice) throw new NotFoundException('Supplier invoice not found');
    if (invoice.status === 'VOIDED') {
      throw new BadRequestException('Invoice already voided');
    }

    const updated = await prismaAny.supplierInvoice.update({
      where: { id: invoiceId },
      data: { status: 'VOIDED' },
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'supplier_invoice.voided',
      entity: 'supplier_invoice',
      entityId: updated.id,
      metadata: { previousStatus: invoice.status },
    });

    return toDto(updated);
  }

  async getStats(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as any;
    const invoices: any[] = await prismaAny.supplierInvoice.findMany({
      where: { buildingId },
      orderBy: { issueDate: 'asc' },
    });

    const countByStatus: Record<string, number> = {
      DRAFT: 0,
      IMPORTED: 0,
      MATCHED: 0,
      VOIDED: 0,
    };
    let totalNetCents = 0;
    let totalVatCents = 0;
    let totalGrossCents = 0;

    const monthlyMap = new Map<string, { netCents: number; vatCents: number; totalCents: number; count: number }>();
    const byClassification: Record<string, { netCents: number; vatCents: number; totalCents: number; count: number }> = {};

    for (const inv of invoices) {
      countByStatus[inv.status] = (countByStatus[inv.status] ?? 0) + 1;
      // Only count non-voided for totals? Include all? For accountant VAT summary, exclude VOIDED.
      if (inv.status !== 'VOIDED') {
        totalNetCents += inv.netCents;
        totalVatCents += inv.vatCents;
        totalGrossCents += inv.totalCents;
      }

      const month = inv.issueDate instanceof Date ? inv.issueDate.toISOString().slice(0, 7) : String(inv.issueDate).slice(0, 7);
      const m = monthlyMap.get(month) ?? { netCents: 0, vatCents: 0, totalCents: 0, count: 0 };
      if (inv.status !== 'VOIDED') {
        m.netCents += inv.netCents;
        m.vatCents += inv.vatCents;
        m.totalCents += inv.totalCents;
      }
      m.count += 1;
      monthlyMap.set(month, m);

      const cls = inv.classification ?? 'UNCLASSIFIED';
      if (inv.status !== 'VOIDED') {
        if (!byClassification[cls]) {
          byClassification[cls] = { netCents: 0, vatCents: 0, totalCents: 0, count: 0 };
        }
        byClassification[cls].netCents += inv.netCents;
        byClassification[cls].vatCents += inv.vatCents;
        byClassification[cls].totalCents += inv.totalCents;
        byClassification[cls].count += 1;
      }
    }

    const monthly = [...monthlyMap.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      totalCount: invoices.length,
      draftCount: countByStatus.DRAFT,
      importedCount: countByStatus.IMPORTED,
      matchedCount: countByStatus.MATCHED,
      voidedCount: countByStatus.VOIDED,
      countByStatus: countByStatus as Record<SupplierStatus, number>,
      totals: {
        netCents: totalNetCents,
        vatCents: totalVatCents,
        totalCents: totalGrossCents,
      },
      totalNetCents,
      totalVatCents,
      totalGrossCents,
      vatSummary: {
        totalNetCents,
        totalVatCents,
        totalGrossCents,
        byClassification,
      },
      monthly,
    };
  }
}
