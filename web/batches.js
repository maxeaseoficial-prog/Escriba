import { LIMITS, checkAbort, optionsFrom } from './core.js?v=20261009-500mb-4h';

export const BATCH_SIZE = 100;
const finished = new Set(['completed', 'partial']);

export function planBatches(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > LIMITS.files) {
    throw new Error(`Selecione entre 1 e ${LIMITS.files} áudios.`);
  }
  const total = Math.ceil(entries.length / BATCH_SIZE);
  return Array.from({ length: total }, (_, index) => {
    const start = index * BATCH_SIZE;
    return { number: index + 1, total, first: start + 1,
      last: Math.min(start + BATCH_SIZE, entries.length), entries: entries.slice(start, start + BATCH_SIZE) };
  });
}

export function batchMessage(count) {
  const total = Math.ceil(count / BATCH_SIZE);
  if (total <= 1) return '';
  if (total === 2) {
    const rest = count - BATCH_SIZE;
    return `Encontrei ${count} áudios. Vou separar em duas etapas. Na primeira etapa, vou transcrever os 100 primeiros áudios e disponibilizar um PDF. Na segunda etapa, vou transcrever os ${rest} restantes e disponibilizar outro PDF. A segunda etapa começa automaticamente, sem reenviar o ZIP.`;
  }
  return `Encontrei ${count} áudios. Vou separar em ${total} etapas de até 100 áudios, com um PDF separado para cada etapa. As etapas começam automaticamente, uma após a outra, sem reenviar o ZIP.`;
}

export function createBatchRun(entries, options, metadata) {
  const plans = planBatches(entries), split = plans.length > 1;
  const settings = optionsFrom(options);
  // Multi-stage runs always produce organized PDFs, even when TXT was selected.
  const outputOptions = Object.freeze(split ? { ...settings, output: 'pdf', organized: true } : settings);
  return {
    split, options: outputOptions, cancelled: false, paused: false, totalFiles: entries.length,
    stages: plans.map(plan => ({ ...plan, status: 'pending', pdf: null, pdfError: '',
      result: { ...metadata, warnings: [...(metadata.warnings || [])], model: settings.model,
        title: split ? `${metadata.title || 'Minha transcrição'} — Etapa ${plan.number} de ${plan.total}` : metadata.title,
        ...(split ? { batch: { number: plan.number, total: plan.total, first: plan.first, last: plan.last, totalFiles: entries.length } } : {}),
        items: [], cancelled: false } })),
  };
}

// A PDF failure pauses BEFORE the next stage. Calling again retries only that PDF;
// completed audio and previously generated PDFs are never processed again.
export async function executeBatches(run, { signal, transcribe, makePDF, onUpdate = () => {} }) {
  checkAbort(signal);
  if (run.cancelled) throw new Error('Este processamento foi cancelado. Inicie uma nova transcrição.');
  run.paused = false;
  for (const stage of run.stages) {
    if (finished.has(stage.status)) continue;
    try {
      checkAbort(signal);
      if (stage.result.items.length < stage.entries.length) {
        stage.status = 'running'; onUpdate(stage);
        for (let i = stage.result.items.length; i < stage.entries.length; i++) {
          checkAbort(signal);
          const entry = stage.entries[i];
          try {
            const output = await transcribe(entry, stage, i);
            checkAbort(signal);
            stage.result.items.push({ ...output, name: entry.name });
          } catch (error) {
            if (signal?.aborted || error.name === 'AbortError') throw error;
            stage.result.items.push({ name: entry.name, error: String(error.message || error) });
          }
          onUpdate(stage);
        }
      }
      checkAbort(signal);
      if (run.split && !stage.pdf) {
        stage.status = 'pdf'; stage.pdfError = ''; onUpdate(stage);
        try {
          stage.pdf = await makePDF(stage.result, run.options);
          if (!(stage.pdf?.blob instanceof Blob) || !stage.pdf.blob.size) throw new Error('O PDF gerado está vazio.');
        } catch (error) {
          stage.pdf = null; stage.pdfError = String(error.message || error);
          stage.status = 'pdf-error'; run.paused = true; onUpdate(stage);
          if (signal?.aborted) throw error;
          return;
        }
      }
      stage.status = stage.result.items.some(item => item.error) ? 'partial' : 'completed';
      onUpdate(stage); // PDF is available in the UI before the next audio starts.
      checkAbort(signal);
    } catch (error) {
      if (!signal?.aborted && error.name !== 'AbortError') throw error;
      run.cancelled = true; run.paused = false;
      if (!finished.has(stage.status)) {
        stage.status = 'cancelled'; stage.result.cancelled = true;
        for (const entry of stage.entries.slice(stage.result.items.length)) {
          stage.result.items.push({ name: entry.name, error: 'Não processado: operação cancelada.' });
        }
      }
      for (const next of run.stages) if (next.status === 'pending') next.status = 'cancelled';
      onUpdate(stage); return;
    }
  }
}

export function stageFilename(stage, format = 'pdf') {
  const suffix = stage.result.cancelled || stage.result.items.some(item => item.error) ? '-parcial' : '';
  return `escriba-etapa-${String(stage.number).padStart(2, '0')}-audios-${stage.first}-${stage.last}${suffix}.${format}`;
}
