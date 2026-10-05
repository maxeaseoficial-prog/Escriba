export const LIMITS = Object.freeze({ upload: 200 * 1024 ** 2, audio: 50 * 1024 ** 2, expanded: 500 * 1024 ** 2, entries: 1000, files: 100, duration: 30 * 60 });
export const AUDIO = new Set(['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'aac', 'webm', 'mp4']);
export const DEFAULTS = Object.freeze({ output: 'pdf', language: 'pt', order: 'date', organized: true, timestamps: false, model: 'base' });
export const extension = name => String(name).split('.').pop().toLowerCase();
export const bytesLabel = value => `${(value / 1024 ** 2).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
export const abortError = () => new DOMException('Processamento cancelado.', 'AbortError');
export function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
export function optionsFrom(value = {}) {
  const out = { ...DEFAULTS };
  for (const [key, choices] of Object.entries({ output: ['pdf', 'txt'], language: ['pt', 'en', 'es', 'auto'], order: ['date', 'name', 'archive'], model: ['tiny', 'base', 'small'] })) {
    if (choices.includes(value?.[key])) out[key] = value[key];
  }
  for (const key of ['organized', 'timestamps']) if (typeof value?.[key] === 'boolean') out[key] = value[key];
  return out;
}
export function validateFile(file) {
  if (!file || !Number.isFinite(file.size) || !file.size) throw new Error('O arquivo está vazio.');
  const ext = extension(file.name);
  if (!AUDIO.has(ext) && ext !== 'zip') throw new Error('Selecione um áudio compatível ou um ZIP.');
  const limit = ext === 'zip' ? LIMITS.upload : LIMITS.audio;
  if (file.size > limit) throw new Error(`Limite: ${bytesLabel(limit)} para ${ext === 'zip' ? 'ZIP' : 'cada áudio'}.`);
}
export function dateFromName(name) {
  const match = String(name).match(/(?:^|\D)(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?:[-_ T]([0-2]\d)[-_.:]([0-5]\d)[-_.:]([0-5]\d))?/);
  if (!match) return null;
  const [, y, m, d, h, min, sec] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d || (h && +h > 23)) return null;
  return { key: `${y}${m}${d}${h || '00'}${min || '00'}${sec || '00'}`, label: `${d}/${m}/${y}${h ? ` às ${h}:${min}:${sec}` : ''}` };
}
export function sortEntries(entries, order) {
  const compare = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
  return [...entries].sort((a, b) => {
    if (order === 'archive') return a.index - b.index;
    if (order === 'date') {
      const x = dateFromName(a.name)?.key, y = dateFromName(b.name)?.key;
      if (x && y && x !== y) return x.localeCompare(y);
      if (Boolean(x) !== Boolean(y)) return x ? -1 : 1;
    }
    return compare(a, b) || a.index - b.index;
  });
}
export function timeLabel(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const n = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
export function transcriptText(result, options) {
  if (!result) return '';
  const sections = result.items.map((item, index) => {
    const date = dateFromName(item.name);
    const heading = options.organized ? `${index + 1}. ${item.name}${date ? `\nData identificada no nome: ${date.label}` : ''}\n\n` : '';
    if (item.error) return `${heading}[Não transcrito: ${item.name} — ${item.error}]`;
    const text = options.timestamps && item.chunks?.length
      ? item.chunks.map(c => `[${timeLabel(c.timestamp?.[0])} – ${timeLabel(c.timestamp?.[1])}] ${c.text.trim()}`).join('\n')
      : item.text.trim();
    return heading + (text || '[Nenhuma fala reconhecida neste áudio. Revise o arquivo.]');
  });
  const warning = result.cancelled ? '[Processamento cancelado: documento parcial.]\n\n' : '';
  return warning + sections.join(options.organized || options.timestamps ? '\n\n' : '\n');
}
