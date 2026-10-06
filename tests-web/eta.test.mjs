import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRemaining, formatEta } from '../web/eta.js';

test('formatEta presents human friendly durations', () => {
  assert.equal(formatEta(30), 'menos de 1 min');
  assert.equal(formatEta(601), 'cerca de 11 min');
  assert.equal(formatEta(3660), 'cerca de 1h 1min');
});

test('estimateRemaining waits for enough observed work', () => {
  assert.equal(estimateRemaining({ elapsedSeconds: 2, processedAudioSeconds: 60, processedFiles: 1, totalFiles: 2 }), null);
});

test('estimateRemaining projects remaining files from observed device speed', () => {
  const seconds = estimateRemaining({
    elapsedSeconds: 60,
    processedAudioSeconds: 120,
    processedFiles: 1,
    currentAudioSeconds: 0,
    currentChunks: 0,
    totalFiles: 3,
  });
  assert.equal(seconds, 120);
});

test('estimateRemaining uses current chunk progress before first audio finishes', () => {
  const seconds = estimateRemaining({
    elapsedSeconds: 25,
    processedAudioSeconds: 0,
    processedFiles: 0,
    currentAudioSeconds: 100,
    currentChunks: 1,
    totalFiles: 1,
  });
  assert.equal(seconds, 75);
});
