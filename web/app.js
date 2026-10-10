import { DEFAULTS, LIMITS, optionsFrom, validateFile, bytesLabel, checkAbort, transcriptText } from './core.js?v=20261010-large-media';
import { openInputs } from './zip.js?v=20261010-large-media';
import { decodeAudio } from './audio.js?v=20261010-large-media';
import { WhisperClient } from './worker-client.js?v=20261010-large-media';
import { downloadBlob, filenameFor, makePDF } from './export.js?v=20261010-large-media';
import { batchMessage, createBatchRun, executeBatches, stageFilename } from './batches.js?v=20261010-large-media';
import { estimateRemaining, formatEta } from './eta.js?v=20261010-large-media';
const $ = id => document.getElementById(id);
const PREFS_KEY = 'escriba.browser.settings.v2';
let settings = { ...DEFAULTS }, selected = null, busy = false, controller = null, result = null, toastTimer;
const client = new WhisperClient();
let batchRun = null, preparing = false, selectionVersion = 0, selectionController;
let etaState = null;
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
  $('transcribe').disabled = value || preparing || !selected || !compatible;
  $('retry-batch').disabled = value;
  $('clear-batches').disabled = value;
  $('open-settings').disabled = $('output-settings').disabled = value || Boolean(batchRun?.paused);
  $('progress-area').hidden = !value;
  $('dropzone').setAttribute('aria-disabled', String(value));
}
function progress(message, detail = '', fraction = null) {
  $('progress-message').textContent = message;
  $('current-file').textContent = detail;
  if (fraction === null) { $('progress-bar').removeAttribute('value'); $('progress-value').textContent = ''; }
  else { const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100); $('progress-bar').value = percent; $('progress-value').textContent = `${percent}%`; }
}
function resetEta(run = null) {
  if (!run) { etaState = null; $('eta-box').hidden = true; return; }
  let processedAudioSeconds = 0, processedFiles = 0;
  for (const stage of run.stages) for (const item of stage.result.items) {
    if (!item.error && Number.isFinite(item.duration)) processedAudioSeconds += item.duration;
    processedFiles++;
  }
  etaState = { startedAt: performance.now(), processedAudioSeconds, processedFiles, currentAudioSeconds: 0, currentChunks: 0, totalFiles: run.totalFiles };
  $('eta-box').hidden = false;
  $('eta-value').textContent = 'Calculando tempo estimado…';
}
function updateEta() {
  if (!etaState) return;
  const seconds = estimateRemaining({
    elapsedSeconds: (performance.now() - etaState.startedAt) / 1000,
    processedAudioSeconds: etaState.processedAudioSeconds,
    processedFiles: etaState.processedFiles,
    currentAudioSeconds: etaState.currentAudioSeconds,
    currentChunks: etaState.currentChunks,
    totalFiles: etaState.totalFiles,
  });
  $('eta-value').textContent = seconds === null ? 'Calculando tempo estimado…' : `Tempo estimado para terminar: ${formatEta(seconds)}`;
}
async function selectFile(file) {
  if (busy || !file) return;
  try { validateFile(file); } catch (error) { notice(error.message); return; }
  selectionController?.abort(); selectionController = new AbortController();
  const version = ++selectionVersion;
  selected = file; preparing = true;
  $('file-name').textContent = file.name; $('file-size').textContent = bytesLabel(file.size);
  $('selected-file').hidden = false; $('dropzone').classList.add('has-file');
  $('batch-plan').hidden = false; $('batch-plan').textContent = 'Conferindo os áudios do arquivo…';
  notice(); setBusy(false);
  try {
    const inputs = await openInputs(file, settings.order, selectionController.signal);
    if (version !== selectionVersion) return;
    const message = batchMessage(inputs.entries.length);
    $('batch-plan').textContent = message || `${inputs.entries.length} áudio(s) encontrado(s). Uma etapa de processamento.`;
    if (message) $('batch-plan').textContent += '\nOs PDFs serão organizados por áudio, mesmo se TXT estiver selecionado nas configurações.';
  } catch (error) {
    if (version !== selectionVersion) return;
    selected = null; $('batch-plan').hidden = true; notice(error.message);
  } finally {
    if (version === selectionVersion) { preparing = false; setBusy(false); }
  }
}
$('choose-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { selectFile(event.target.files[0]); event.target.value = ''; });
$('remove-file').addEventListener('click', () => { selectionController?.abort(); selectionVersion++; preparing = false; $('batch-plan').hidden = true; selected = null; $('selected-file').hidden = true; $('dropzone').classList.remove('has-file'); setBusy(false); });
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
function clearBatches() {
  for (const stage of batchRun?.stages || []) { if (stage.url) URL.revokeObjectURL(stage.url); for (const url of stage.urls || []) URL.revokeObjectURL(url); }
  batchRun = null; $('batch-results').hidden = true; $('batch-list').replaceChildren();
  $('retry-batch').hidden = true;
}
function showBatches() {
  if (!batchRun?.split) return;
  $('batch-results').hidden = false;
  const complete = batchRun.stages.filter(s => ['completed', 'partial'].includes(s.status)).length;
  const ready = batchRun.stages.filter(s => s.pdf).length;
  $('batches-summary').textContent = `${complete} de ${batchRun.stages.length} etapas processadas · ${ready} PDF(s) disponível(is)`
    + (batchRun.cancelled ? ' · Processamento cancelado.' : batchRun.paused ? ' · Pausado: tente gerar o PDF para continuar.' : '');
  $('retry-batch').hidden = !batchRun.paused;
  const cards = batchRun.stages.map(stage => {
    const card = document.createElement('article'); card.className = 'batch-card'; card.dataset.status = stage.status;
    const title = document.createElement('h3'); title.textContent = `Etapa ${stage.number} de ${stage.total} — Áudios ${stage.first} a ${stage.last}`;
    const info = document.createElement('p');
    const ok = stage.result.items.filter(item => !item.error).length;
    const states = {
      pending: 'Aguardando a etapa anterior.', running: `Transcrevendo: ${stage.result.items.length} de ${stage.entries.length} áudios processados.`,
      pdf: 'Preparando o PDF desta etapa…', 'pdf-error': 'As transcrições estão preservadas. Não foi possível gerar o PDF. A próxima etapa ainda não começou.',
      completed: `${ok} áudios transcritos. PDF pronto para baixar.`,
      partial: `${ok} de ${stage.entries.length} áudios transcritos. PDF parcial: os arquivos que falharam estão identificados.`,
      cancelled: stage.result.items.length ? 'Etapa interrompida. Resultado parcial preservado; arquivos não processados estão identificados.' : 'Não iniciada: processamento cancelado.',
    };
    info.textContent = states[stage.status]; card.append(title, info);
    if (stage.pdfError) { const error = document.createElement('p'); error.className = 'batch-error'; error.textContent = stage.pdfError; card.append(error); }
    if (stage.pdf?.substitutions) { const warning = document.createElement('p'); warning.textContent = 'Alguns símbolos foram substituídos no PDF. O TXT preserva todos os caracteres.'; card.append(warning); }
    const actions = document.createElement('div'); actions.className = 'batch-actions';
    if (stage.pdf) {
      if (stage.pdf.parts?.length > 1) {
        stage.urls ||= stage.pdf.parts.map(part => URL.createObjectURL(part.blob));
        stage.pdf.parts.forEach((part, i) => {
          const link = document.createElement('a'); link.className = 'primary-button'; link.href = stage.urls[i];
          link.download = stageFilename(stage).replace(/\.pdf$/, `-parte-${String(i + 1).padStart(2, '0')}-de-${String(stage.pdf.parts.length).padStart(2, '0')}.pdf`);
          link.textContent = `PDF ${i + 1}/${stage.pdf.parts.length} — Etapa ${stage.number}`;
          actions.append(link);
        });
      } else {
        stage.url ||= URL.createObjectURL(stage.pdf.blob);
        const link = document.createElement('a'); link.className = 'primary-button'; link.href = stage.url;
        link.download = stageFilename(stage); link.textContent = `Baixar PDF — Etapa ${stage.number}${stage.status === 'completed' ? '' : ' (parcial)'}`;
        actions.append(link);
      }
    } else if (stage.status === 'cancelled' && stage.result.items.length) {
      const button = document.createElement('button'); button.className = 'secondary-button'; button.textContent = 'Gerar PDF parcial';
      const owner = batchRun;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { stage.pdf = await makePDF(stage.result, owner.options); stage.pdfError = ''; }
        catch (error) { stage.pdfError = String(error.message || error); }
        finally { if (batchRun === owner) showBatches(); }
      });
      actions.append(button);
    }
    if (stage.result.items.length && !['running', 'pdf'].includes(stage.status)) {
      const txt = document.createElement('button'); txt.className = 'secondary-button'; txt.textContent = `Baixar TXT — Etapa ${stage.number}`;
      const options = batchRun.options;
      txt.addEventListener('click', () => downloadBlob(new Blob(['\uFEFF' + transcriptText(stage.result, options)], { type: 'text/plain;charset=utf-8' }), stageFilename(stage, 'txt')));
      actions.append(txt);
    }
    card.append(actions); return card;
  });
  $('batch-list').replaceChildren(...cards);
}
async function processStages(signal) {
  const run = batchRun;
  resetEta(run);
  await executeBatches(run, {
    signal,
    transcribe: async (entry, stage, index) => {
      const label = `Etapa ${stage.number} de ${stage.total} · Áudio ${stage.first + index} de ${run.totalFiles}: ${entry.name}`;
      progress('Lendo o áudio no navegador…', label);
      const blob = await entry.read(signal); checkAbort(signal);
      const audio = await decodeAudio(blob, signal); checkAbort(signal);
      etaState.currentAudioSeconds = audio.duration; etaState.currentChunks = 0; updateEta();
      progress('Transcrevendo neste aparelho…', `${label} · Mantenha a aba aberta.`);
      const PART_SECONDS = 30 * 60, PART_SAMPLES = PART_SECONDS * 16000;
      const totalParts = Math.ceil(audio.samples.length / PART_SAMPLES);
      const texts = [], chunks = [];
      for (let part = 0; part < totalParts; part++) {
        checkAbort(signal);
        const start = part * PART_SAMPLES, end = Math.min(audio.samples.length, start + PART_SAMPLES);
        const partAudio = audio.samples.slice(start, end);
        progress('Transcrevendo neste aparelho…', `${label} · Parte ${part + 1} de ${totalParts}.`);
        const partial = await client.request({ type: 'transcribe', audio: partAudio, language: run.options.language }, signal, event => {
          if (event.stage === 'inference') {
            etaState.currentChunks = part * Math.ceil(PART_SECONDS / 25) + event.completed;
            updateEta();
            progress('Transcrevendo neste aparelho…', `${label} · Parte ${part + 1} de ${totalParts} · ${event.completed} trecho(s).`);
          }
        });
        if (partial.text?.trim()) texts.push(partial.text.trim());
        const offset = part * PART_SECONDS;
        for (const chunk of partial.chunks || []) {
          const stamp = chunk.timestamp || [];
          chunks.push({ ...chunk, timestamp: [
            Number.isFinite(stamp[0]) ? stamp[0] + offset : stamp[0],
            Number.isFinite(stamp[1]) ? stamp[1] + offset : stamp[1],
          ] });
        }
      }
      const output = { text: texts.join(' ').trim(), chunks };
      etaState.processedAudioSeconds += audio.duration; etaState.processedFiles += 1; etaState.currentAudioSeconds = 0; etaState.currentChunks = 0; updateEta();
      return { duration: audio.duration, ...output };
    },
    makePDF,
    onUpdate: stage => {
      showBatches();
      if (stage.status === 'pdf') progress('Gerando o PDF da etapa…', `Etapa ${stage.number} de ${stage.total}. O PDF ficará disponível antes da próxima etapa.`);
      if (stage.pdf && !stage.announced) { stage.announced = true; toast(`PDF da etapa ${stage.number} disponível para baixar.`); }
    },
  });
  if (run.split) {
    showBatches();
    if (run.paused) notice('O texto desta etapa foi preservado, mas o PDF não pôde ser gerado. Clique em “Tentar gerar PDF e continuar”. Os áudios já transcritos não serão repetidos.');
    else if (run.cancelled) notice('Processamento cancelado. Os PDFs concluídos continuam disponíveis nesta aba.');
  } else {
    result = run.stages[0].result;
    if (result.items.length) showResult();
    if (run.cancelled) notice('Processamento cancelado. O resultado parcial está identificado.');
  }
}
async function withProcessing(task) {
  controller = new AbortController(); const { signal } = controller;
  let wakeLock; setBusy(true); notice();
  try {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Optional. */ }
    await task(signal);
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') {
      if (batchRun) {
        batchRun.cancelled = true; batchRun.paused = false;
        for (const stage of batchRun.stages) if (stage.status === 'pending') stage.status = 'cancelled';
        showBatches();
      }
      notice('Processamento cancelado. Os resultados já concluídos continuam nesta aba.');
    } else {
      notice(`Não foi possível continuar. ${String(error.message || error)}. Os PDFs já gerados continuam disponíveis.`);
      client.stop();
    }
  } finally {
    await wakeLock?.release().catch(() => {});
    controller = null; resetEta(); setBusy(false);
  }
}
$('transcribe').addEventListener('click', async () => {
  if (!selected || busy || preparing || !compatible) return;
  const file = selected, options = { ...settings };
  clearBatches(); result = null; $('result').hidden = true;
  await withProcessing(async signal => {
    progress('Preparando seus arquivos…', 'Os áudios não serão enviados a um servidor.');
    const inputs = await openInputs(file, options.order, signal); checkAbort(signal);
    batchRun = createBatchRun(inputs.entries, options, {
      title: $('document-title').value.trim() || 'Minha transcrição', createdAt: new Date().toISOString(), warnings: inputs.warnings,
    });
    const message = batchMessage(inputs.entries.length);
    if (message) { $('batch-plan').textContent = message; $('batch-plan').hidden = false; }
    showBatches();
    await client.request({ type: 'load', model: options.model }, signal, event => {
      if (event.stage === 'download') {
        const downloaded = event.loaded ? bytesLabel(event.loaded) : '';
        progress('Baixando o modelo para este aparelho…', `${event.file || 'Modelo'} ${downloaded ? `· ${downloaded}` : ''}. Isso não é envio do seu áudio.`, Number.isFinite(event.progress) ? event.progress / 100 : null);
      } else progress(event.message || 'Preparando Whisper…', 'No primeiro uso há download. Mantenha esta aba aberta.');
    });
    await processStages(signal);
  });
});
$('retry-batch').addEventListener('click', async () => {
  if (busy || !batchRun?.paused) return;
  await withProcessing(processStages);
});
$('clear-batches').addEventListener('click', () => {
  if (busy) return;
  clearBatches(); client.stop(); notice(); setBusy(false);
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
      const output = await makePDF(result, settings);
      if (output.parts?.length > 1) {
        output.parts.forEach((part, i) => downloadBlob(part.blob, filenameFor(`${result.title}-parte-${String(i + 1).padStart(2, '0')}-de-${String(output.parts.length).padStart(2, '0')}`, 'pdf')));
        toast(`Transcrição grande: ${output.parts.length} PDFs foram preparados.`);
      } else downloadBlob(output.blob, filenameFor(result.title, 'pdf'));
      if (output.substitutions) toast('Alguns símbolos não cabem na fonte do PDF. O TXT mantém todos os caracteres.');
    }
  } catch (error) { notice(`Não foi possível gerar o PDF. O texto continua disponível para copiar ou baixar em TXT. ${error.message || error}`); }
  finally { $('download').disabled = false; $('download-other').disabled = false; }
}
$('download').addEventListener('click', () => download(settings.output));
$('download-other').addEventListener('click', () => download(settings.output === 'pdf' ? 'txt' : 'pdf'));
$('delete-job').addEventListener('click', () => { clearBatches(); result = null; $('transcript').value = ''; $('result').hidden = true; client.stop(); toast('Transcrição removida desta página.'); });
window.addEventListener('beforeunload', event => { if (busy || batchRun?.stages.some(stage => stage.result.items.length)) { event.preventDefault(); event.returnValue = ''; } });
const compatible = Boolean(globalThis.Worker && globalThis.WebAssembly && (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext));
if (!compatible) notice('Este navegador não oferece os recursos necessários. Abra o Escriba em um navegador atualizado.');
$('size-hint').textContent = `Arquivo ou ZIP até ${bytesLabel(LIMITS.upload)} · Até 8 h por áudio/vídeo · Até 100 arquivos por etapa`;
updateLabels(); setBusy(false);
