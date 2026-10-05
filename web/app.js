import { DEFAULTS, LIMITS, optionsFrom, validateFile, bytesLabel, checkAbort, transcriptText } from './core.js';
import { openInputs } from './zip.js';
import { decodeAudio } from './audio.js';
import { WhisperClient } from './worker-client.js';
import { downloadBlob, filenameFor, makePDF } from './export.js';
const $ = id => document.getElementById(id);
const PREFS_KEY = 'escriba.browser.settings.v2';
let settings = { ...DEFAULTS }, selected = null, busy = false, controller = null, result = null, toastTimer;
const client = new WhisperClient();
try { settings = optionsFrom(JSON.parse(localStorage.getItem(PREFS_KEY))); } catch { /* Private mode or invalid preferences: use defaults. */ }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function updateLabels() {
  const pdf = settings.output === 'pdf';
  $('output-label').textContent = pdf ? 'Documento PDF' : 'Arquivo de texto';
  $('download-label').textContent = pdf ? 'Baixar PDF' : 'Baixar TXT';
  $('download-other').textContent = pdf ? 'Baixar TXT' : 'Baixar PDF';
  if (result) $('transcript').value = transcriptText(result, settings);
}
function setBusy(value) {
  busy = value;
  for (const id of ['choose-file', 'file-input', 'remove-file', 'document-title', 'open-settings', 'output-settings', 'delete-job']) $(id).disabled = value;
  $('transcribe').disabled = value || !selected || !compatible;
  $('progress-area').hidden = !value;
  $('dropzone').setAttribute('aria-disabled', String(value));
}
function progress(message, detail = '', fraction = null) {
  $('progress-message').textContent = message;
  $('current-file').textContent = detail;
  if (fraction === null) { $('progress-bar').removeAttribute('value'); $('progress-value').textContent = ''; }
  else { const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100); $('progress-bar').value = percent; $('progress-value').textContent = `${percent}%`; }
}
function selectFile(file) {
  if (busy || !file) return;
  try { validateFile(file); } catch (error) { notice(error.message); return; }
  selected = file; $('file-name').textContent = file.name; $('file-size').textContent = bytesLabel(file.size);
  $('selected-file').hidden = false; $('dropzone').classList.add('has-file'); notice(); setBusy(false);
}
$('choose-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { selectFile(event.target.files[0]); event.target.value = ''; });
$('remove-file').addEventListener('click', () => { selected = null; $('selected-file').hidden = true; $('dropzone').classList.remove('has-file'); setBusy(false); });
for (const name of ['dragover', 'dragenter']) $('dropzone').addEventListener(name, event => { event.preventDefault(); if (!busy) $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => {
  if (busy) return;
  if (event.dataTransfer.files.length > 1) { notice('Para vários áudios, coloque os arquivos em um ZIP e selecione o ZIP.'); return; }
  selectFile(event.dataTransfer.files[0]);
});
function openSettings() {
  const form = $('settings-form');
  for (const [key, value] of Object.entries(settings)) {
    const input = form.elements.namedItem(key);
    if (input?.type === 'checkbox') input.checked = value; else if (input) input.value = value;
  }
  $('settings-dialog').showModal();
}
$('open-settings').addEventListener('click', openSettings); $('output-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('click', event => { if (event.target === $('settings-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
$('settings-form').addEventListener('submit', event => {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  settings = optionsFrom({ ...Object.fromEntries(data), organized: data.has('organized'), timestamps: data.has('timestamps') });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(settings)); } catch { toast('Preferências aplicadas. O navegador não permitiu salvá-las.'); }
  updateLabels(); $('settings-dialog').close();
});
function showResult() {
  if (!result?.items.length) return;
  const ok = result.items.filter(item => !item.error).length, errors = result.items.length - ok;
  $('result-title').textContent = !ok ? 'Nenhum áudio foi transcrito' : result.cancelled || errors ? 'Transcrição parcial disponível' : 'Sua transcrição está pronta';
  $('result-meta').textContent = `${ok} áudio(s) processado(s)${errors ? ` · ${errors} não transcrito(s)` : ''} · Whisper ${result.model} · Neste navegador`;
  const warnings = [...result.warnings];
  if (result.cancelled) warnings.unshift('Cancelado. Os áudios que não terminaram estão identificados no documento.');
  if (errors) warnings.push('Confira os arquivos que falharam. Eles não foram omitidos do documento.');
  $('result-warning').textContent = warnings.join('\n'); $('result-warning').hidden = !warnings.length;
  $('result').hidden = false; updateLabels();
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('transcribe').addEventListener('click', async () => {
  if (!selected || busy || !compatible) return;
  notice(); result = null; $('result').hidden = true; controller = new AbortController();
  const { signal } = controller, options = { ...settings }, file = selected;
  let wakeLock, inputs;
  setBusy(true); progress('Preparando seus arquivos…', 'Os áudios não serão enviados a um servidor.');
  try {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Not required for transcription. */ }
    inputs = await openInputs(file, options.order, signal); checkAbort(signal);
    result = { title: $('document-title').value.trim() || 'Minha transcrição', createdAt: new Date().toISOString(), model: options.model, warnings: inputs.warnings, items: [], cancelled: false };
    await client.request({ type: 'load', model: options.model }, signal, event => {
      if (event.stage === 'download') {
        const downloaded = event.loaded ? bytesLabel(event.loaded) : '';
        progress('Baixando o modelo para este aparelho…', `${event.file || 'Modelo'} ${downloaded ? `· ${downloaded}` : ''}. Isso não é envio do seu áudio.`, Number.isFinite(event.progress) ? event.progress / 100 : null);
      } else progress(event.message || 'Preparando Whisper…', 'No primeiro uso há download. Mantenha esta aba aberta.');
    });
    for (let i = 0; i < inputs.entries.length; i++) {
      checkAbort(signal); const entry = inputs.entries[i];
      const label = `Áudio ${i + 1} de ${inputs.entries.length}: ${entry.name}`;
      progress('Lendo o áudio no navegador…', label);
      try {
        const blob = await entry.read(); checkAbort(signal);
        const audio = await decodeAudio(blob, signal); checkAbort(signal);
        progress('Transcrevendo neste aparelho…', `${label} · Mantenha a aba aberta.`);
        const output = await client.request({ type: 'transcribe', audio: audio.samples, language: options.language }, signal, event => {
          if (event.stage === 'inference') progress('Transcrevendo neste aparelho…', `${label} · ${event.completed} trecho(s) processado(s).`);
        });
        checkAbort(signal);
        result.items.push({ name: entry.name, duration: audio.duration, ...output });
      } catch (error) {
        if (signal.aborted || error.name === 'AbortError') throw error;
        result.items.push({ name: entry.name, error: String(error.message || error) });
      }
    }
    progress('Processamento concluído', '', 1); showResult();
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') {
      if (result && inputs && result.items.length) {
        result.cancelled = true;
        for (const entry of inputs.entries.slice(result.items.length)) result.items.push({ name: entry.name, error: 'Não processado: operação cancelada.' });
        showResult();
      } else result = null;
      notice('Processamento cancelado. Nenhum áudio foi enviado a um servidor.');
    } else {
      if (!result?.items.length) result = null;
      notice(`Não foi possível iniciar a transcrição. ${String(error.message || error)}. Confira sua conexão para baixar o modelo e tente o modelo Leve nas configurações.`);
      client.stop();
    }
  } finally {
    await wakeLock?.release().catch(() => {});
    controller = null; setBusy(false);
  }
});
$('cancel-job').addEventListener('click', () => { controller?.abort(); client.stop(); progress('Cancelando processamento…'); });
$('copy-text').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('transcript').value); toast('Texto copiado.'); }
  catch { $('transcript').select(); toast('Selecione e copie o texto com Ctrl+C ou Command+C.'); }
});
async function download(format) {
  if (!result) return;
  $('download').disabled = true; $('download-other').disabled = true;
  try {
    if (format === 'txt') downloadBlob(new Blob(['\uFEFF' + transcriptText(result, settings)], { type: 'text/plain;charset=utf-8' }), filenameFor(result.title, 'txt'));
    else {
      toast('Preparando o PDF neste navegador…');
      const output = await makePDF(result, settings); downloadBlob(output.blob, filenameFor(result.title, 'pdf'));
      if (output.substitutions) toast('Alguns símbolos não cabem na fonte do PDF. O TXT mantém todos os caracteres.');
    }
  } catch (error) { notice(`Não foi possível gerar o PDF. O texto continua disponível para copiar ou baixar em TXT. ${error.message || error}`); }
  finally { $('download').disabled = false; $('download-other').disabled = false; }
}
$('download').addEventListener('click', () => download(settings.output));
$('download-other').addEventListener('click', () => download(settings.output === 'pdf' ? 'txt' : 'pdf'));
$('delete-job').addEventListener('click', () => { result = null; $('transcript').value = ''; $('result').hidden = true; client.stop(); toast('Transcrição removida desta página.'); });
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
const compatible = Boolean(globalThis.Worker && globalThis.WebAssembly && (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext));
if (!compatible) notice('Este navegador não oferece os recursos necessários. Abra o Escriba em um navegador atualizado.');
$('size-hint').textContent = `ZIP até ${bytesLabel(LIMITS.upload)} · Cada áudio até ${bytesLabel(LIMITS.audio)} / 30 min`;
updateLabels(); setBusy(false);
