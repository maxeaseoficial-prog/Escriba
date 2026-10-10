import { transcriptText } from './core.js?v=20261010-large-media';
import { PDF_URL } from './runtime-config.js?v=20261010-large-media';
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function filenameFor(title, format) {
  const clean = (title || 'escriba-transcricao').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 100);
  return `${clean || 'escriba-transcricao'}.${format}`;
}
export function wrapText(text, width, measure) {
  const lines = []; let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && measure(`${line} ${word}`) > width) { lines.push(line); line = ''; }
    if (measure(word) > width) {
      for (const char of word) {
        if (line && measure(line + char) > width) { lines.push(line); line = ''; }
        line += char;
      }
    } else line += (line ? ' ' : '') + word;
  }
  lines.push(line); return lines;
}
let pdfLibrary;
export function loadPDFLibrary() {
  return pdfLibrary ||= import(PDF_URL).catch(error => { pdfLibrary = null; throw error; });
}
export const MAX_PDF_PAGES = 80;
export async function makePDF(result, options) {
  const { PDFDocument, StandardFonts, rgb } = await loadPDFLibrary();
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const purple = rgb(0.43, 0.32, 0.69), ink = rgb(0.17, 0.18, 0.22), muted = rgb(0.46, 0.47, 0.51);
  let substitutions = 0, page, y;
  const safe = text => [...String(text).normalize('NFC')].map(char => {
    if (char === '\n') return char;
    try { normal.encodeText(char); return char; } catch { substitutions++; return '?'; }
  }).join('');
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]); y = 755;
    page.drawText('Escriba', { x: 48, y: 797, size: 16, font: bold, color: purple });
    page.drawText('TRANSCRIÇÃO DE ÁUDIO', { x: 373, y: 800, size: 9, font: normal, color: muted });
    page.drawLine({ start: { x: 48, y: 779 }, end: { x: 547, y: 779 }, color: rgb(0.89, 0.88, 0.93), thickness: 0.7 });
  };
  const paragraph = (value, size = 11, font = normal, color = ink) => {
    for (const line of wrapText(safe(value), 499, text => font.widthOfTextAtSize(text, size))) {
      if (y < 66) newPage();
      if (line) page.drawText(line, { x: 48, y, size, font, color });
      y -= size * 1.5;
    }
  };
  newPage();
  paragraph(result.title || 'Minha transcrição', 22, bold, purple); y -= 9;
  paragraph(`Gerado em ${new Date(result.createdAt).toLocaleString('pt-BR')} · ${result.items.length} áudio(s) listado(s)`, 9, normal, muted);
  paragraph('A data acima é de geração do documento, não de gravação.', 9, normal, muted);
  if (result.batch) {
    const b = result.batch;
    paragraph(`Etapa ${b.number} de ${b.total} · Áudios ${b.first} a ${b.last} de ${b.totalFiles}`, 10, bold, purple);
    if (!result.cancelled && result.items.some(item => item.error)) paragraph('Documento parcial: há áudios não transcritos, identificados abaixo.', 10, bold);
  }
  y -= 15;
  for (const line of transcriptText(result, options).split('\n')) paragraph(line);
  if (result.warnings.length) { y -= 12; paragraph('Avisos do processamento', 11, bold); for (const warning of result.warnings) paragraph(warning, 9, normal, muted); }
  if (substitutions) paragraph('Alguns caracteres não disponíveis na fonte foram substituídos por ?. O TXT preserva todos os caracteres.', 9, normal, muted);
  const pages = pdf.getPages();
  pages.forEach((item, i) => {
    item.drawText('Transcrição automática. Revise informações importantes.', { x: 48, y: 35, size: 8, font: normal, color: muted });
    item.drawText(`${i + 1} / ${pages.length}`, { x: 514, y: 35, size: 8, font: normal, color: muted });
  });
  pdf.setTitle(safe(result.title || 'Transcrição Escriba')); pdf.setCreator('Escriba — processamento no navegador');
  const fullBlob = new Blob([await pdf.save()], { type: 'application/pdf' });
  const parts = [];
  if (pages.length > MAX_PDF_PAGES) {
    for (let start = 0; start < pages.length; start += MAX_PDF_PAGES) {
      const end = Math.min(pages.length, start + MAX_PDF_PAGES);
      const part = await PDFDocument.create();
      const copied = await part.copyPages(pdf, Array.from({ length: end - start }, (_, i) => start + i));
      copied.forEach(page => part.addPage(page));
      part.setTitle(safe(`${result.title || 'Transcrição Escriba'} — Parte ${parts.length + 1}`));
      part.setCreator('Escriba — processamento no navegador');
      parts.push({ blob: new Blob([await part.save()], { type: 'application/pdf' }), firstPage: start + 1, lastPage: end });
    }
  }
  return { blob: fullBlob, substitutions, parts, totalPages: pages.length };
}
