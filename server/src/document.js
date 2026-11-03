// Extracts plain text from teacher PDF uploads for AI Pack Forge (PDF only by design).
// Cost strategy: extraction is local/free; only a capped, evenly-sampled excerpt is sent to the model.
const MAX_BYTES = 4 * 1024 * 1024;

export function excerptForModel(text, limit = 8000) {
  const clean = String(text ?? '').replace(/\s+\n/g, '\n').trim();
  if (clean.length <= limit) return clean;
  // Even sampling keeps intro, middle and conclusion topics instead of only the first pages.
  const chunk = Math.floor(limit / 3);
  const mid = Math.floor(clean.length / 2);
  return [clean.slice(0, chunk), clean.slice(mid - Math.floor(chunk / 2), mid + Math.ceil(chunk / 2)), clean.slice(-chunk)].join('\n...\n');
}

export async function extractDocumentText(input) {
  const name = String(input?.name ?? 'document').toLowerCase();
  const base64 = String(input?.contentBase64 ?? '');
  if (!base64) throw new Error('No file was received.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Upload a document up to 4 MB.');
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const standardFontDataUrl = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, standardFontDataUrl }).promise;
    const pages = [];
    const maxPages = Math.min(pdf.numPages, 60);
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str ?? '').join(' '));
    }
    const text = pages.join('\n').trim();
    if (text.length < 80) throw new Error('That PDF looks scanned/image-only. Upload a text-based PDF so the AI can read the lesson.');
    return { text, pages: pdf.numPages, characters: text.length };
  }
  throw new Error('Only PDF lessons are accepted. Convert the file to PDF and try again.');
}
