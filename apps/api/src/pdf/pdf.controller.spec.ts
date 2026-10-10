import { StreamableFile } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PdfController, contentDisposition } from './pdf.controller';
import { PdfService } from './pdf.service';

describe('PdfController', () => {
  const user = { id: 'u', email: 'a@b.gr', role: 'ADMIN', buildingId: 'b' } as AuthenticatedUser;
  const file = {
    body: Buffer.from('%PDF-1.3 test'),
    contentType: 'application/pdf',
    filename: 'eidopoiitirio-2026-09-Α1.pdf',
    etag: 'e1',
  };

  it('streams the PDF bytes (not a JSON-serialised Buffer) with headers', async () => {
    const service = { invoicePdf: jest.fn().mockResolvedValue(file) } as unknown as PdfService;
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
        return this;
      },
    };

    const result = await new PdfController(service).invoicePdf('inv-1', user, res as never);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders().type).toBe('application/pdf');
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toContain("filename*=UTF-8''eidopoiitirio-2026-09-%CE%911.pdf");
  });

  it('builds an ASCII-safe fallback filename', () => {
    expect(contentDisposition('Α1.pdf')).toMatch(/^inline; filename="_1\.pdf"; filename\*=UTF-8''/);
  });
});
