import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

export interface PdfFile {
  body: Buffer;
  contentType: string;
  filename: string;
  etag: string;
}

export const PDF_CONTENT_TYPE = 'application/pdf';

/**
 * Resolves the bundled NotoSansJP font (Feature 5, CJK glyphs) when present.
 * Downloads are documented in apps/api/scripts/fetch-fonts.sh; without the
 * font the PDF falls back to built-in Helvetica (Latin-only).
 */
function resolveFontPath(): string | undefined {
  const candidates = [
    path.join(process.cwd(), 'assets', 'fonts', 'NotoSansJP-Regular.ttf'),
    path.join(process.cwd(), 'assets', 'fonts', 'NotoSansJP', 'NotoSansJP-Regular.ttf'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const FONT_PATH = resolveFontPath();
const FONT = FONT_PATH ? 'NotoSansJP' : 'Helvetica';

/** Renders a pdfkit document into a Buffer (async — pdfkit streams data). */
async function renderDoc(
  build: (doc: PdfKit.PDFDocument) => void,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFDocument = require('pdfkit') as {
    new (options?: { size?: string; margin?: number }): PdfKit.PDFDocument;
  };
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  if (FONT_PATH) doc.registerFont('NotoSansJP', FONT_PATH);
  build(doc);
  doc.end();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    doc.on('data', (chunk: unknown) =>
      chunks.push(Buffer.from(chunk as string)),
    );
    doc.on('end', () => resolve());
    doc.on('error', (error: unknown) => reject(error));
  });
  return Buffer.concat(chunks);
}

@Injectable()
export class PdfService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /invoices/:id/pdf — a single 請求書 for one invoice. */
  async invoicePdf(invoiceId: string, user: AuthenticatedUser): Promise<PdfFile> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        unit: { include: { building: { include: { branding: true } } } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertSameBuilding(user, invoice.buildingId);
    if (user.role !== 'ADMIN' && user.role !== 'BUILDING_OWNER') {
      const ownership = await this.prisma.ownership.findFirst({
        where: { userId: user.id, unitId: invoice.unitId },
      });
      if (!ownership) {
        throw new ForbiddenException('You do not own this unit');
      }
    }

    const expenses = await this.prisma.expense.findMany({
      where: {
        buildingId: invoice.buildingId,
        periodYearMonth: invoice.periodYearMonth,
      },
      include: { shares: { where: { unitId: invoice.unitId } }, category: true },
    });
    const lineItems = expenses
      .map((expense) => ({
        description: expense.description,
        category: expense.category.name,
        amountCents: expense.shares[0]?.amountCents ?? 0,
      }))
      .filter((item) => item.amountCents > 0);

    const building = invoice.unit.building;
    const branding = building.branding;
    const body = await renderDoc((doc) =>
      buildInvoicePdf(doc, {
        buildingName: building.name,
        orgName: branding?.orgName ?? building.name,
        primaryColor: branding?.primaryColor ?? '#1e40af',
        invoiceRegistrationNo: building.invoiceRegistrationNo ?? null,
        unitLabel: invoice.unit.label,
        periodYearMonth: invoice.periodYearMonth,
        totalCents: invoice.totalCents,
        paidCents: invoice.paidCents,
        status: invoice.status,
        lineItems,
      }),
    );

    return {
      body,
      contentType: PDF_CONTENT_TYPE,
      filename: `seikyu-${invoice.periodYearMonth}-${invoice.unit.label}.pdf`,
      etag: `${invoice.id}-${invoice.periodYearMonth}`,
    };
  }

  /** GET /statements/:unitId/pdf?year=… — annual statement PDF. */
  async statementPdf(unitId: string, year: string, user: AuthenticatedUser): Promise<PdfFile> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      include: { building: { include: { branding: true } } },
    });
    if (!unit) throw new NotFoundException('Unit not found');
    assertSameBuilding(user, unit.buildingId);
    if (user.role !== 'ADMIN' && user.role !== 'BUILDING_OWNER') {
      const ownership = await this.prisma.ownership.findFirst({
        where: { userId: user.id, unitId },
      });
      if (!ownership) {
        throw new ForbiddenException('You do not own this unit');
      }
    }

    const expenses = await this.prisma.expense.findMany({
      where: {
        buildingId: unit.buildingId,
        periodYearMonth: { startsWith: `${year}-` },
      },
      include: { shares: { where: { unitId } } },
      orderBy: { periodYearMonth: 'asc' },
    });
    const invoices = await this.prisma.invoice.findMany({
      where: {
        buildingId: unit.buildingId,
        unitId,
        periodYearMonth: { startsWith: `${year}-` },
      },
      orderBy: { periodYearMonth: 'asc' },
    });

    const rows = expenses
      .map((expense) => ({
        period: expense.periodYearMonth,
        description: expense.description,
        invoicedCents: expense.shares[0]?.amountCents ?? 0,
      }))
      .filter((row) => row.invoicedCents > 0);
    const totalInvoiced = rows.reduce((sum, row) => sum + row.invoicedCents, 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + inv.paidCents, 0);
    const branding = unit.building.branding;

    const body = await renderDoc((doc) =>
      buildStatementPdf(doc, {
        buildingName: unit.building.name,
        orgName: branding?.orgName ?? unit.building.name,
        primaryColor: branding?.primaryColor ?? '#1e40af',
        unitLabel: unit.label,
        year,
        rows,
        totalInvoicedCents: totalInvoiced,
        totalPaidCents: totalPaid,
        balanceCents: totalInvoiced - totalPaid,
      }),
    );

    return {
      body,
      contentType: PDF_CONTENT_TYPE,
      filename: `statement-${unit.label}-${year}.pdf`,
      etag: `${unit.id}-${year}`,
    };
  }
}

interface InvoicePdfInput {
  buildingName: string;
  orgName: string;
  primaryColor: string;
  invoiceRegistrationNo: string | null;
  unitLabel: string;
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
  status: string;
  lineItems: { description: string; category: string; amountCents: number }[];
}

function buildInvoicePdf(doc: PdfKit.PDFDocument, input: InvoicePdfInput): void {
  doc.font(FONT).fontSize(10).fillColor('#6b7280').text('インボイス / 請求書', 48, 48, { align: 'center' });
  doc.font(FONT).fontSize(18).fillColor(input.primaryColor).text('請求書', 48, 64, { align: 'center' });
  doc.moveDown(1);
  doc.font(FONT).fontSize(11).fillColor('#111827');
  doc.text(input.orgName);
  doc.moveDown(0.2);
  doc.font(FONT).fontSize(9).fillColor('#6b7280');
  doc.text(`登録番号: ${input.invoiceRegistrationNo ?? '(未登録)'}`);
  doc.moveDown();

  doc.font(FONT).fontSize(11).fillColor('#111827');
  doc.text(`部屋: ${input.unitLabel}`);
  doc.text(`期間: ${input.periodYearMonth}`);
  doc.text(`合計金額: ${money(input.totalCents)} 円`);
  doc.text(`支払済み: ${money(input.paidCents)} 円`);
  doc.text(`残高: ${money(input.totalCents - input.paidCents)} 円`);
  doc.text(`支払状況: ${input.status === 'PAID' ? '支払済' : '未払'}`);

  doc.moveDown();
  doc.font(FONT).fontSize(12).text('明細');
  doc.moveDown(0.2);
  for (const item of input.lineItems) {
    doc.font(FONT).fontSize(10);
    doc.text(`${item.category} — ${item.description}`);
    doc.font(FONT).fontSize(10);
    doc.text(`  ${money(item.amountCents)} 円`, 100);
  }
  if (input.lineItems.length === 0) {
    doc.font(FONT).fontSize(10).text('明細なし', 100);
  }
}

interface StatementPdfInput {
  buildingName: string;
  orgName: string;
  primaryColor: string;
  unitLabel: string;
  year: string;
  rows: { period: string; description: string; invoicedCents: number }[];
  totalInvoicedCents: number;
  totalPaidCents: number;
  balanceCents: number;
}

function buildStatementPdf(doc: PdfKit.PDFDocument, input: StatementPdfInput): void {
  doc.font(FONT).fontSize(18).fillColor(input.primaryColor).text('年間明細書', 48, 48, { align: 'center' });
  doc.moveDown(0.6);
  doc.font(FONT).fontSize(11).fillColor('#111827');
  doc.text(input.orgName);
  doc.moveDown();
  doc.text(`部屋: ${input.unitLabel}`);
  doc.text(`年度: ${input.year}`);
  doc.moveDown();

  doc.font(FONT).fontSize(12).text('月別明細');
  doc.moveDown(0.2);
  for (const row of input.rows) {
    doc.font(FONT).fontSize(10);
    doc.text(`${row.period}  ${row.description}`);
    doc.font(FONT).fontSize(10);
    doc.text(`  ${money(row.invoicedCents)} 円`, 100);
  }
  if (input.rows.length === 0) {
    doc.font(FONT).fontSize(10).text('データがありません', 100);
  }

  doc.moveDown();
  doc.font(FONT).fontSize(11);
  doc.text(`年間合計: ${money(input.totalInvoicedCents)} 円`);
  doc.text(`支払済み: ${money(input.totalPaidCents)} 円`);
  doc.text(`残高: ${money(input.balanceCents)} 円`);
}

function money(cents: number): string {
  return new Intl.NumberFormat('ja-JP').format(cents / 100);
}