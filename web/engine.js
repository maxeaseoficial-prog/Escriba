import { TRANSFORMERS_URL, MODEL_HOST, MODELS } from './runtime-config.js?v=20261010-large-media';
let library, recognizer, activeModel;
export function recognitionOptions(language, onChunk) {
  const names = { pt: 'portuguese', en: 'english', es: 'spanish' };
  return {
    task: 'transcribe', ...(names[language] ? { language: names[language] } : {}),
    return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
    num_beams: 1, do_sample: false, chunk_callback: onChunk,
  };
}
export async function loadModel(model, notify) {
  if (!Object.hasOwn(MODELS, model)) throw new Error('Modelo inválido.');
  if (recognizer && activeModel === model) return;
  notify({ stage: 'loading', message: 'Preparando o motor Whisper no navegador…' });
  library ||= await import(TRANSFORMERS_URL);
  library.env.allowLocalModels = false;
  library.env.remoteHost = MODEL_HOST;
  library.env.useBrowserCache = true;
  // Single-thread WASM also works without cross-origin isolation / SharedArrayBuffer.
  // The dedicated Web Worker keeps inference off the UI thread.
  library.env.backends.onnx.wasm.numThreads = 1;
  library.env.backends.onnx.wasm.proxy = false;
  if (recognizer) { await recognizer.dispose(); recognizer = null; activeModel = null; }
  recognizer = await library.pipeline('automatic-speech-recognition', MODELS[model], {
    device: 'wasm', dtype: 'q8',
    progress_callback: data => {
      if (data.status === 'progress') notify({ stage: 'download', file: data.file, loaded: data.loaded, total: data.total, progress: data.progress });
      else if (['initiate', 'download'].includes(data.status)) notify({ stage: 'loading', message: `Carregando ${data.file || 'modelo'}…` });
    },
  });
  activeModel = model;
  notify({ stage: 'ready', message: 'Whisper pronto. Processamento neste aparelho.' });
}
export async function recognize(samples, language, notify) {
  if (!recognizer) throw new Error('O modelo ainda não foi carregado.');
  if (!(samples instanceof Float32Array) || !samples.length) throw new Error('Áudio inválido para transcrição.');
  let completed = 0;
  const output = await recognizer(samples, recognitionOptions(language, () => notify({ stage: 'inference', completed: ++completed })));
  if (!output || typeof output.text !== 'string') throw new Error('O motor não retornou uma transcrição válida.');
  return { text: output.text, chunks: output.chunks || [] };
}
