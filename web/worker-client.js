import { abortError, checkAbort } from './core.js?v=20261010-large-media';
export class WhisperClient {
  constructor() { this.worker = null; this.pending = null; this.sequence = 0; }
  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./worker.js?v=20261010-large-media', import.meta.url), { type: 'module', name: 'escriba-whisper' });
    this.worker.onmessage = ({ data }) => {
      const job = this.pending;
      if (!job || data.id !== job.id) return;
      if (data.type === 'progress') { job.notify(data); return; }
      this.pending = null; job.cleanup();
      if (data.type === 'error') job.reject(new Error(data.message)); else job.resolve(data.result);
    };
    this.worker.onerror = () => this.stop(new Error('Falha ao iniciar o Whisper. Confira a conexão e o suporte a WebAssembly do navegador.'));
    this.worker.onmessageerror = () => this.stop(new Error('Falha ao comunicar com o motor. Tente novamente.'));
  }
  request(data, signal, notify = () => {}) {
    checkAbort(signal);
    if (this.pending) return Promise.reject(new Error('Já existe uma transcrição em andamento.'));
    this.ensureWorker();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const onAbort = () => this.stop(abortError());
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      this.pending = { id, resolve, reject, notify, cleanup };
      signal?.addEventListener('abort', onAbort, { once: true });
      try { this.worker.postMessage({ ...data, id }, data.audio ? [data.audio.buffer] : []); }
      catch (error) { this.stop(error); }
    });
  }
  stop(error = abortError()) {
    this.worker?.terminate(); this.worker = null;
    const job = this.pending; this.pending = null;
    if (job) { job.cleanup(); job.reject(error); }
  }
}
