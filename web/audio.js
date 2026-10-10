import { LIMITS, checkAbort } from './core.js?v=20261010-large-media';
export async function decodeAudio(blob, signal) {
  checkAbort(signal);
  const AudioContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!AudioContext) throw new Error('Seu navegador não oferece decodificação de áudio. Use um navegador atualizado.');
  const context = new AudioContext(1, 1, 16000);
  let buffer;
  try { buffer = await context.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('Áudio inválido ou codec não suportado neste navegador. Tente MP3, WAV, MP4 ou MOV com áudio AAC e use um navegador atualizado.'); }
  checkAbort(signal);
  if (!buffer.length || !Number.isFinite(buffer.duration)) throw new Error('Áudio vazio ou com duração inválida.');
  if (buffer.duration > LIMITS.duration) throw new Error('Nesta versão, cada áudio ou vídeo pode ter até 8 horas. Divida os áudios maiores.');
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
  }
  return { samples, duration: samples.length / 16000 };
}
