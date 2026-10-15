export type DocumentFormat = 'txt' | 'md' | 'docx' | 'pdf' | 'pptx' | 'xlsx';
export type DocumentReadMode = 'auto' | 'simple' | 'enhanced';
export type DocumentBlock = { id: string; kind: 'paragraph' | 'heading' | 'table' | 'list' | 'other'; text: string; page?: number; heading?: string };
export type DocumentExtraction = { parser: 'simple' | 'docling'; sourceName: string; blocks: DocumentBlock[]; warnings: string[]; metadata: { version?: string; pageCount?: number } };
export type DocumentParserStatus = {
  available: boolean; configured: boolean; ready: boolean; pdfReady?: boolean; version?: string;
  formats: string[]; limits: { maxBytes: number; maxPages: number; timeoutMs: number; maxCharacters: number };
  message: string;
};
export type DocumentParseResult = ({ ok: true; text: string; format: DocumentFormat } & DocumentExtraction) | { ok: false; error: string; code: string };
