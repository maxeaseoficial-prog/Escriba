import { loadModel, recognize } from './engine.js';
let busy = false;
self.onmessage = async ({ data }) => {
  const { id, type, model, language, audio } = data;
  if (busy) { self.postMessage({ id, type: 'error', message: 'O motor já está processando um áudio.' }); return; }
  busy = true;
  const notify = detail => self.postMessage({ id, type: 'progress', ...detail });
  try {
    let result = null;
    if (type === 'load') await loadModel(model, notify);
    else if (type === 'transcribe') result = await recognize(audio, language, notify);
    else throw new Error('Comando desconhecido.');
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: String(error?.message || error) });
  } finally { busy = false; }
};
