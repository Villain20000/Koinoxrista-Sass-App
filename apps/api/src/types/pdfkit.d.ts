declare namespace PdfKit {
  interface PDFTextOptions {
    align?: 'left' | 'center' | 'right' | 'justify';
    continued?: boolean;
    width?: number;
  }

  interface PDFDocument {
    end(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    font(
      name?: string,
      family?: { family: string; bold: string; italic: string; bolditalic: string },
    ): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    text(
      text: string,
      x?: number,
      y?: number,
      options?: PDFTextOptions,
    ): this;
    moveDown(lines?: number): this;
    registerFont(name: string, src: string): this;
    pipe(dest: unknown): unknown;
  }
}

declare module 'pdfkit' {
  const PDFDocument: {
    new (options?: {
      size?: string;
      margin?: number;
    }): PdfKit.PDFDocument;
  };
  export = PDFDocument;
  export type PDFDocument = PdfKit.PDFDocument;
}