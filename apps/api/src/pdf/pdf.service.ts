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
import { buildMonthlyNotice, MonthlyNotice, PAYER_LABELS } from './monthly-notice';

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
      orderBy: { createdAt: 'asc' },
    });
    const earlier = await this.prisma.invoice.findMany({
      where: {
        unitId: invoice.unitId,
        payer: invoice.payer,
        periodYearMonth: { lt: invoice.periodYearMonth },
        status: { not: 'PAID' },
      },
      select: { totalCents: true, paidCents: true },
    });
    const previousBalanceCents = (earlier ?? []).reduce(
      (sum, row) => sum + Math.max(0, row.totalCents - row.paidCents),
      0,
    );
    const ownerships = await this.prisma.ownership.findMany({
      where: { unitId: invoice.unitId },
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    const wantTenant = invoice.payer !== 'OWNER';
    const holders = (ownerships ?? []).filter((o) =>
      wantTenant ? o.occupantType === 'TENANT' : o.occupantType !== 'TENANT',
    );
    const names = (holders.length ? holders : ownerships ?? [])
      .map((o) => `${o.user.firstName} ${o.user.lastName}`.trim())
      .join(', ');

    const notice = buildMonthlyNotice({
      unit: invoice.unit,
      payer: invoice.payer ?? 'OCCUPANT',
      expenses,
      invoiceTotalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
      previousBalanceCents,
    });

    const building = invoice.unit.building;
    const branding = building.branding;
    const body = await renderDoc((doc) =>
      buildNoticePdf(doc, {
        orgName: branding?.orgName ?? building.name,
        address: [building.address, building.city].filter(Boolean).join(', '),
        primaryColor: branding?.primaryColor ?? '#1e40af',
        unitLabel: invoice.unit.label,
        names,
        periodYearMonth: invoice.periodYearMonth,
        status: invoice.status,
        notice,
      }),
    );

    return {
      body,
      contentType: PDF_CONTENT_TYPE,
      filename: `eidopoiitirio-${invoice.periodYearMonth}-${invoice.unit.label}${invoice.payer === 'OWNER' ? '-idioktitis' : ''}.pdf`,
      etag: `${invoice.id}-${invoice.totalCents}-${invoice.paidCents}`,
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

interface NoticePdfInput {
  orgName: string;
  address: string;
  primaryColor: string;
  unitLabel: string;
  names: string;
  periodYearMonth: string;
  status: string;
  notice: MonthlyNotice;
}

/** Monthly ειδοποιητήριο: header, per-column table, totals. */
function buildNoticePdf(doc: PdfKit.PDFDocument, input: NoticePdfInput): void {
  const { notice } = input;
  const left = 48;
  const width = 499;
  doc.font(FONT_BOLD).fontSize(16).fillColor(input.primaryColor)
    .text('ΕΙΔΟΠΟΙΗΤΗΡΙΟ ΚΟΙΝΟΧΡΗΣΤΩΝ', left, 48, { width, align: 'center' as const });
  doc.font(FONT).fontSize(10).fillColor('#374151')
    .text(greekPeriod(input.periodYearMonth), { width, align: 'center' as const });
  doc.moveDown(0.8);

  doc.font(FONT_BOLD).fontSize(11).fillColor('#111827').text(input.orgName, left);
  if (input.address) doc.font(FONT).fontSize(9).fillColor('#6b7280').text(input.address, left);
  doc.moveDown(0.5);
  doc.font(FONT).fontSize(10).fillColor('#111827');
  doc.text(`Διαμέρισμα: ${input.unitLabel}`, left);
  if (input.names) doc.text(`Υπόχρεος: ${input.names}`, left);
  doc.text(`Χρέωση: ${PAYER_LABELS[notice.payer]}`, left);
  doc.moveDown(0.8);

  const cols = [
    { title: 'Στήλη', x: left, w: 130 },
    { title: 'Κατανομή', x: left + 130, w: 110 },
    { title: 'Συντελεστής', x: left + 240, w: 80 },
    { title: 'Σύνολο κτιρίου', x: left + 320, w: 90 },
    { title: 'Μερίδιο', x: left + 410, w: 89 },
  ];
  const row = (cells: string[], bold = false, size = 9) => {
    const y = doc.y;
    doc.font(bold ? FONT_BOLD : FONT).fontSize(size).fillColor('#111827');
    let maxY = y;
    cells.forEach((cell, i) => {
      doc.text(cell, cols[i].x, y, { width: cols[i].w - 4, align: i >= 3 ? ('right' as const) : ('left' as const) });
      maxY = Math.max(maxY, doc.y);
    });
    doc.y = maxY + 2;
    doc.x = left;
  };
  row(cols.map((c) => c.title), true);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor('#9ca3af').stroke();
  doc.y += 3;
  for (const column of notice.columns) {
    row([column.name, column.strategyLabel, column.coefficient, money(column.buildingCents), money(column.unitCents)], true);
    for (const line of column.lines) {
      row([`   ${line.description}`, '', '', money(line.buildingCents), money(line.unitCents)], false, 8);
    }
  }
  if (notice.columns.length === 0) {
    doc.font(FONT).fontSize(9).text('Δεν υπάρχουν χρεώσεις για την περίοδο.', left);
  }
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor('#9ca3af').stroke();
  doc.moveDown(0.6);

  const total = (label: string, cents: number, bold = false) => {
    const y = doc.y;
    doc.font(bold ? FONT_BOLD : FONT).fontSize(bold ? 11 : 10).fillColor('#111827');
    doc.text(label, left + 240, y, { width: 170 });
    doc.text(money(cents), left + 410, y, { width: 85, align: 'right' });
    doc.x = left;
  };
  total('Κοινόχρηστα περιόδου', notice.periodCents);
  if (notice.previousBalanceCents > 0) total('Προηγούμενο υπόλοιπο', notice.previousBalanceCents);
  if (notice.paidCents > 0) total('Πληρωμές περιόδου', -notice.paidCents);
  total('ΠΛΗΡΩΤΕΟ ΠΟΣΟ', notice.dueCents, true);
  doc.moveDown(1);
  doc.font(FONT).fontSize(8).fillColor('#6b7280').text(
    input.status === 'PAID' ? 'Η χρέωση της περιόδου έχει εξοφληθεί.' : 'Παρακαλούμε εξοφλήστε μέσω της εφαρμογής (κάρτα / IRIS).',
    left,
  );
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
