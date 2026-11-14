import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { RESOURCE_TYPE_LABELS } from '@cloudsentry/shared-types';
import type { ReportData } from './data';

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const COLORS = {
  text: rgb(0.1, 0.12, 0.16),
  muted: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.85, 0.87, 0.9),
  accent: rgb(0.11, 0.33, 0.73),
};

/** Standard PDF fonts only support WinAnsi; replace anything else so rendering never throws. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

const money = (v: number | null, currency = 'USD') =>
  v === null
    ? 'n/a'
    : `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  ensure(space: number): void {
    if (this.y - space < PAGE.margin + 20) this.newPage();
  }

  wrap(text: string, size: number, width: number, font: PDFFont): string[] {
    const words = pdfSafe(text).split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  }

  text(
    text: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {},
  ): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = PAGE.margin + (opts.indent ?? 0);
    for (const line of this.wrap(text, size, PAGE.width - PAGE.margin - x, font)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? COLORS.text });
      this.y -= size + 4;
    }
  }

  heading(text: string): void {
    this.ensure(40);
    this.y -= 10;
    this.text(text, { size: 14, bold: true, color: COLORS.accent });
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y },
      end: { x: PAGE.width - PAGE.margin, y: this.y },
      thickness: 0.5,
      color: COLORS.rule,
    });
    this.y -= 8;
  }

  table(headers: string[], rows: string[][], widths: number[]): void {
    const size = 8.5;
    const total = PAGE.width - PAGE.margin * 2;
    const cols = widths.map((w) => w * total);
    const drawRow = (cells: string[], bold: boolean) => {
      const wrapped = cells.map((c, i) =>
        this.wrap(c, size, (cols[i] ?? 50) - 6, bold ? this.bold : this.font),
      );
      const height = Math.max(...wrapped.map((w) => w.length)) * (size + 3) + 4;
      this.ensure(height);
      let x = PAGE.margin;
      wrapped.forEach((lines, i) => {
        lines.forEach((l, j) =>
          this.page.drawText(l, {
            x: x + 2,
            y: this.y - size - j * (size + 3),
            size,
            font: bold ? this.bold : this.font,
            color: bold ? COLORS.muted : COLORS.text,
          }),
        );
        x += cols[i] ?? 50;
      });
      this.y -= height;
      this.page.drawLine({
        start: { x: PAGE.margin, y: this.y + 2 },
        end: { x: PAGE.width - PAGE.margin, y: this.y + 2 },
        thickness: 0.3,
        color: COLORS.rule,
      });
    };
    drawRow(headers, true);
    for (const r of rows) drawRow(r, false);
    this.y -= 6;
  }
}

export async function renderPdf(data: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(data.report.title));
  doc.setProducer('CloudSentry');
  doc.setCreationDate(new Date(data.generatedAt));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);

  w.text('CloudSentry', { size: 11, bold: true, color: COLORS.accent });
  w.text(data.report.title, { size: 18, bold: true });
  w.text(`${data.tenant.name} - generated ${data.generatedAt.replace('T', ' ').slice(0, 16)} UTC`, {
    color: COLORS.muted,
  });
  w.text(
    `Period: ${data.report.periodStart.slice(0, 10)} to ${data.report.periodEnd.slice(0, 10)} - Scope: ${data.report.accountId ?? 'all accounts'}`,
    { color: COLORS.muted },
  );

  w.heading('Summary');
  w.table(
    ['Metric', 'Value'],
    [
      [
        'Month-to-date spend (AWS Cost Explorer, billed)',
        money(data.costs.currentMonthToDate, data.costs.currency),
      ],
      ['Previous month spend (billed)', money(data.costs.previousMonth, data.costs.currency)],
      ['Estimated potential monthly savings', `${money(data.savings.potentialMonthly)} (estimate)`],
      ['Estimated potential annual savings', `${money(data.savings.potentialAnnual)} (estimate)`],
      ['Accepted recommendations (monthly, estimate)', money(data.savings.acceptedMonthly)],
      ['Realized savings (estimate)', money(data.savings.realizedMonthlyEstimate)],
      ['Active resources', String(data.inventory.total)],
      [
        'Active findings',
        `${data.findings.active} (critical ${data.findings.bySeverity.CRITICAL}, high ${data.findings.bySeverity.HIGH})`,
      ],
    ],
    [0.6, 0.4],
  );
  if (data.costs.accountsWithoutCostData.length) {
    w.text(`No Cost Explorer data for: ${data.costs.accountsWithoutCostData.join(', ')}`, {
      size: 8.5,
      color: COLORS.muted,
    });
  }

  w.heading('Accounts');
  w.table(
    ['Account', 'Alias', 'Status', 'Regions', 'Last successful scan'],
    data.accounts.map((a) => [
      a.accountId + (a.dataSource === 'SYNTHETIC' ? ' (synthetic)' : ''),
      a.alias,
      a.status,
      a.regions.join(', '),
      a.lastSuccessfulScanAt?.slice(0, 16).replace('T', ' ') ?? 'never',
    ]),
    [0.2, 0.2, 0.16, 0.24, 0.2],
  );

  w.heading('Resource inventory');
  w.table(
    ['Resource type', 'Count'],
    data.inventory.byType.map((t) => [RESOURCE_TYPE_LABELS[t.resourceType], String(t.count)]),
    [0.7, 0.3],
  );
  w.table(
    ['Region', 'Count'],
    data.inventory.byRegion.map((r) => [r.region, String(r.count)]),
    [0.7, 0.3],
  );

  w.heading('Cost breakdown (top services, current month, billed)');
  w.table(
    ['Service', 'Cost'],
    data.costs.topServices.map((s) => [s.key, money(s.amount, data.costs.currency)]),
    [0.7, 0.3],
  );

  w.heading('Optimization opportunities (estimates)');
  w.table(
    ['Recommendation', 'Resource', 'Monthly', 'Confidence / risk', 'Status'],
    data.savings.top.map((r) => [
      r.title,
      `${r.resourceId} (${r.region})`,
      `${r.savings.estimateType === 'UPPER_BOUND' ? 'up to ' : ''}${money(r.estimatedMonthlySavings)}`,
      `${r.confidence} / ${r.riskLevel}`,
      r.status,
    ]),
    [0.34, 0.26, 0.14, 0.14, 0.12],
  );
  if (data.savings.unpriced)
    w.text(`${data.savings.unpriced} recommendation(s) could not be priced and are excluded from totals.`, {
      size: 8.5,
      color: COLORS.muted,
    });

  w.heading('Findings');
  w.table(
    ['Finding', 'Resource', 'Severity', 'First detected', 'Status'],
    data.findings.top.map((f) => [
      f.title,
      `${f.resourceId} (${f.region})`,
      f.severity,
      f.firstDetectedAt.slice(0, 10),
      f.status,
    ]),
    [0.36, 0.26, 0.12, 0.14, 0.12],
  );

  w.heading('Scan metadata');
  w.table(
    ['Scan', 'Account', 'Trigger', 'Requested', 'Status', 'Resources'],
    data.scans.map((s) => [
      s.scanId,
      s.accountId,
      s.trigger,
      s.requestedAt.slice(0, 16).replace('T', ' '),
      s.status,
      String(s.summary?.resourcesDiscovered ?? '-'),
    ]),
    [0.28, 0.16, 0.12, 0.18, 0.16, 0.1],
  );

  w.heading('Notes');
  for (const d of data.disclaimers) w.text(`- ${d}`, { size: 9 });

  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`CloudSentry report ${data.report.reportId} - page ${i + 1} of ${pages.length}`, {
      x: PAGE.margin,
      y: 24,
      size: 7.5,
      font,
      color: COLORS.muted,
    }),
  );
  return doc.save();
}
