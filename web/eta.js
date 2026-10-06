export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) return 'menos de 1 min';
  const minutes = Math.ceil(rounded / 60);
  if (minutes < 60) return `cerca de ${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `cerca de ${hours}h ${rest}min` : `cerca de ${hours}h`;
}

export function estimateRemaining({
  elapsedSeconds = 0,
  processedAudioSeconds = 0,
  processedFiles = 0,
  currentAudioSeconds = 0,
  currentChunks = 0,
  totalFiles = 0,
} = {}) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 3 || totalFiles < 1) return null;
  const chunkHopSeconds = 25;
  const currentCovered = Math.min(Math.max(0, currentAudioSeconds), Math.max(0, currentChunks) * chunkHopSeconds);
  const observedAudio = Math.max(0, processedAudioSeconds) + currentCovered;
  if (observedAudio < 8) return null;
  const realtimeFactor = elapsedSeconds / observedAudio;
  if (!Number.isFinite(realtimeFactor) || realtimeFactor <= 0) return null;
  const knownFiles = Math.max(0, processedFiles) + (currentAudioSeconds > 0 ? 1 : 0);
  const knownDuration = Math.max(0, processedAudioSeconds) + Math.max(0, currentAudioSeconds);
  const averageDuration = knownDuration / Math.max(1, knownFiles);
  const remainingUnknownFiles = Math.max(0, totalFiles - knownFiles);
  const estimatedTotalAudio = knownDuration + remainingUnknownFiles * averageDuration;
  const remainingAudio = Math.max(0, estimatedTotalAudio - observedAudio);
  return remainingAudio * realtimeFactor;
}
