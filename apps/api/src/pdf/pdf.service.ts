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
 * Bundled Noto Sans (SIL OFL 1.1, Latin + Greek + Cyrillic) lives in
 * src/assets/fonts and is copied next to main.js by webpack. Without it
 * pdfkit falls back to Helvetica/WinAnsi, which cannot encode Greek.
 */
const FONT_DIR_CANDIDATES = [
  path.join(__dirname, 'assets', 'fonts'),
  path.join(__dirname, '..', 'assets', 'fonts'),
  path.join(process.cwd(), 'assets', 'fonts'),
  path.join(process.cwd(), 'src', 'assets', 'fonts'),
  path.join(process.cwd(), 'apps', 'api', 'src', 'assets', 'fonts'),
];

export function resolveFontDir(): string | undefined {
  return FONT_DIR_CANDIDATES.find((dir) =>
    fs.existsSync(path.join(dir, 'NotoSans-Regular.ttf')),
  );
}

const FONT_DIR = resolveFontDir();
const FONT = FONT_DIR ? 'NotoSans' : 'Helvetica';
const FONT_BOLD = FONT_DIR ? 'NotoSans-Bold' : 'Helvetica-Bold';

/** Renders a pdfkit document into a Buffer (async — pdfkit streams data). */
async function renderDoc(
  build: (doc: PdfKit.PDFDocument) => void,
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFDocument = require('pdfkit') as {
    new (options?: { size?: string; margin?: number }): PdfKit.PDFDocument;
  };
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  if (FONT_DIR) {
    doc.registerFont('NotoSans', path.join(FONT_DIR, 'NotoSans-Regular.ttf'));
    const bold = path.join(FONT_DIR, 'NotoSans-Bold.ttf');
    doc.registerFont('NotoSans-Bold', fs.existsSync(bold) ? bold : path.join(FONT_DIR, 'NotoSans-Regular.ttf'));
  }
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

  /** GET /invoices/:id/pdf — monthly ειδοποιητήριο for one invoice. */
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
      filename: `eidopoiitirio-${invoice.periodYearMonth}-${invoice.unit.label}.pdf`,
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
      filename: `katastasi-${unit.label}-${year}.pdf`,
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
  doc.font(FONT_BOLD).fontSize(18).fillColor(input.primaryColor).text('ΕΙΔΟΠΟΙΗΤΗΡΙΟ ΚΟΙΝΟΧΡΗΣΤΩΝ', 48, 48, { align: 'center' });
  doc.moveDown(0.6);
  doc.font(FONT_BOLD).fontSize(11).fillColor('#111827').text(input.orgName);
  doc.font(FONT).fontSize(9).fillColor('#6b7280');
  if (input.invoiceRegistrationNo) doc.text(`Αρ. μητρώου: ${input.invoiceRegistrationNo}`);
  doc.moveDown();

  doc.font(FONT).fontSize(11).fillColor('#111827');
  doc.text(`Διαμέρισμα: ${input.unitLabel}`);
  doc.text(`Περίοδος: ${greekPeriod(input.periodYearMonth)}`);
  doc.text(`Σύνολο: ${money(input.totalCents)}`);
  doc.text(`Πληρωμένο: ${money(input.paidCents)}`);
  doc.font(FONT_BOLD).text(`Υπόλοιπο: ${money(input.totalCents - input.paidCents)}`);
  doc.font(FONT).text(`Κατάσταση: ${input.status === 'PAID' ? 'Εξοφλημένο' : 'Ανεξόφλητο'}`);

  doc.moveDown();
  doc.font(FONT_BOLD).fontSize(12).text('Ανάλυση δαπανών');
  doc.moveDown(0.2);
  for (const item of input.lineItems) {
    doc.font(FONT).fontSize(10);
    doc.text(`${item.category} — ${item.description}`);
    doc.text(`  ${money(item.amountCents)}`, 100);
  }
  if (input.lineItems.length === 0) {
    doc.font(FONT).fontSize(10).text('Δεν υπάρχουν δαπάνες', 100);
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
  doc.font(FONT_BOLD).fontSize(18).fillColor(input.primaryColor).text('ΕΤΗΣΙΑ ΚΑΤΑΣΤΑΣΗ ΛΟΓΑΡΙΑΣΜΟΥ', 48, 48, { align: 'center' });
  doc.moveDown(0.6);
  doc.font(FONT_BOLD).fontSize(11).fillColor('#111827').text(input.orgName);
  doc.font(FONT).moveDown();
  doc.text(`Διαμέρισμα: ${input.unitLabel}`);
  doc.text(`Έτος: ${input.year}`);
  doc.moveDown();

  doc.font(FONT_BOLD).fontSize(12).text('Χρεώσεις ανά μήνα');
  doc.moveDown(0.2);
  for (const row of input.rows) {
    doc.font(FONT).fontSize(10);
    doc.text(`${greekPeriod(row.period)}  ${row.description}`);
    doc.text(`  ${money(row.invoicedCents)}`, 100);
  }
  if (input.rows.length === 0) {
    doc.font(FONT).fontSize(10).text('Δεν υπάρχουν δεδομένα', 100);
  }

  doc.moveDown();
  doc.font(FONT).fontSize(11);
  doc.text(`Σύνολο χρεώσεων: ${money(input.totalInvoicedCents)}`);
  doc.text(`Πληρωμές: ${money(input.totalPaidCents)}`);
  doc.font(FONT_BOLD).text(`Υπόλοιπο: ${money(input.balanceCents)}`);
}

const GREEK_MONTHS = [
  'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
];

/** "2026-09" → "Σεπτέμβριος 2026". */
export function greekPeriod(periodYearMonth: string): string {
  const [year, month] = periodYearMonth.split('-');
  const name = GREEK_MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : periodYearMonth;
}

/** Cents → "1.234,56 €" (el-GR). */
export function money(cents: number): string {
  return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
