import { AUDIO, LIMITS, bytesLabel, checkAbort, extension, sortEntries, validateFile } from './core.js?v=20261009-500mb-4h';
const decoder = new TextDecoder('utf-8');
const fail = message => { throw new Error(message); };
const u16 = (view, n) => view.getUint16(n, true);
const u32 = (view, n) => view.getUint32(n, true);
export function crc32(data) {
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
async function read(blob, start, length) {
  if (start < 0 || length < 0 || start + length > blob.size) fail('ZIP truncado ou inválido.');
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}
// Read metadata first. No filesystem extraction; audio entries are inflated one at a time.
export async function openInputs(file, order = 'date', signal) {
  validateFile(file); checkAbort(signal);
  if (extension(file.name) !== 'zip') return { entries: [{ name: file.name, index: 0, read: async () => file }], warnings: [] };
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await read(file, tailStart, file.size - tailStart);
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tv, i) === 0x06054b50 && i + 22 + u16(tv, i + 20) === tail.length) { eocd = i; break; }
  }
  if (eocd < 0) fail('Não foi possível ler este ZIP. Recrie-o sem senha.');
  const count = u16(tv, eocd + 10), size = u32(tv, eocd + 12), offset = u32(tv, eocd + 16);
  if (u16(tv, eocd + 4) || u16(tv, eocd + 6) || u16(tv, eocd + 8) !== count) fail('ZIP dividido em volumes não é suportado.');
  if (count === 65535 || size === 0xffffffff || offset === 0xffffffff) fail('ZIP64 não é suportado nesta versão. Use um ZIP comum.');
  if (count > LIMITS.entries || size > 4 * 1024 ** 2 || offset + size > tailStart + eocd) fail('ZIP excede os limites ou possui estrutura inválida.');
  const central = await read(file, offset, size), view = new DataView(central.buffer);
  const entries = [], warnings = [], seen = new Set();
  let p = 0, expanded = 0, ignored = 0;
  for (let index = 0; index < count; index++) {
    checkAbort(signal);
    if (p + 46 > size || u32(view, p) !== 0x02014b50) fail('Diretório do ZIP inválido.');
    const flags = u16(view, p + 8), method = u16(view, p + 10), crc = u32(view, p + 16);
    const compressed = u32(view, p + 20), uncompressed = u32(view, p + 24);
    const nameLength = u16(view, p + 28), extraLength = u16(view, p + 30), commentLength = u16(view, p + 32);
    const attributes = u32(view, p + 38), local = u32(view, p + 42);
    if (!nameLength || p + 46 + nameLength + extraLength + commentLength > size) fail('Nome ou metadados inválidos no ZIP.');
    const rawName = central.slice(p + 46, p + 46 + nameLength);
    const name = decoder.decode(rawName).replaceAll('\\', '/');
    p += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) fail('ZIP com senha não é suportado.');
    if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..') || /[\x00-\x1f]/.test(name)) fail('O ZIP contém um caminho inseguro.');
    if (((attributes >>> 16) & 0xf000) === 0xa000) fail('Links simbólicos não são aceitos no ZIP.');
    if ([compressed, uncompressed, local].includes(0xffffffff) || u16(view, p - (46 + nameLength + extraLength + commentLength) + 34)) fail('ZIP64 ou volumes divididos não são suportados.');
    expanded += uncompressed;
    if (expanded > LIMITS.expanded || uncompressed / Math.max(1, compressed) > 1000) fail('ZIP excede o limite descompactado ou apresenta compressão excessiva.');
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop().startsWith('.')) continue;
    if (!AUDIO.has(extension(name))) { ignored++; continue; }
    if (seen.has(name)) fail('O ZIP contém nomes de áudio duplicados.');
    seen.add(name);
    if (!uncompressed || uncompressed > LIMITS.audio) fail(`Áudio vazio ou maior que ${bytesLabel(LIMITS.audio)}: ${name}`);
    if (entries.length >= LIMITS.files) fail(`Use no máximo ${LIMITS.files} áudios por ZIP, divididos em etapas de 100.`);
    if (![0, 8].includes(method)) fail(`Compressão não suportada em ${name}. Use ZIP padrão (Deflate).`);
    entries.push({ name, index, read: async (readSignal = signal) => {
      checkAbort(readSignal);
      const header = await read(file, local, 30), h = new DataView(header.buffer);
      if (u32(h, 0) !== 0x04034b50 || u16(h, 8) !== method || u16(h, 6) !== flags) fail('Cabeçalho de áudio inválido no ZIP.');
      const start = local + 30 + u16(h, 26) + u16(h, 28);
      if (start + compressed > offset) fail('Áudio do ZIP invade a área de metadados.');
      const localName = await read(file, local + 30, u16(h, 26));
      if (localName.length !== rawName.length || localName.some((b, i) => b !== rawName[i])) fail('Nome divergente nos cabeçalhos do ZIP.');
      let stream = file.slice(start, start + compressed).stream();
      if (method === 8) {
        try { stream = stream.pipeThrough(new DecompressionStream('deflate-raw')); }
        catch { fail('Este navegador não abre ZIP comprimido. Atualize o navegador ou selecione o áudio sem ZIP.'); }
      }
      const reader = stream.getReader(); const chunks = []; let total = 0;
      const onAbort = () => { void reader.cancel().catch(() => {}); };
      readSignal?.addEventListener('abort', onAbort, { once: true });
      try {
        while (true) {
          checkAbort(readSignal);
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > uncompressed || total > LIMITS.audio) fail('Tamanho descompactado excede o permitido.');
          chunks.push(value);
        }
        checkAbort(readSignal);
        if (total !== uncompressed) fail('Tamanho do áudio divergente no ZIP.');
        const data = new Uint8Array(total); let position = 0;
        for (const chunk of chunks) { data.set(chunk, position); position += chunk.byteLength; }
        if (crc32(data) !== crc) fail('Áudio corrompido no ZIP (CRC inválido).');
        return new Blob([data]);
      } finally { readSignal?.removeEventListener('abort', onAbort); await reader.cancel().catch(() => {}); }
    } });
  }
  if (!entries.length) fail('Nenhum áudio compatível encontrado no ZIP.');
  if (ignored) warnings.push(`${ignored} arquivo(s) que não são áudios foram ignorados (incluindo textos, fotos ou outros ZIPs).`);
  return { entries: sortEntries(entries, order), warnings };
}
