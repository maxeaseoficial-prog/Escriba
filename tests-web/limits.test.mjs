import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUDIO, LIMITS, validateFile } from '../web/core.js';
import { openInputs, crc32 } from '../web/zip.js';
import { decodeAudio } from '../web/audio.js';

const MB = 1024 ** 2;
// These fixtures exercise metadata validation, not audio recognition or large-file performance.
// A declared size can differ from the payload only for tests that do not extract the entry.
function zipFixture(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, size, payload = Buffer.alloc(256 * 1024, 7) } of entries) {
    const filename = Buffer.from(name), crc = crc32(payload);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(size ?? payload.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(size ?? payload.length, 24); central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, filename, payload); centrals.push(central, filename);
    offset += local.length + filename.length + payload.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new File([...locals, directory, end], 'test.zip');
}

test('500 MB per file and four-hour duration are configured', () => {
  assert.deepEqual(LIMITS, { upload: 500 * MB, audio: 500 * MB, expanded: 1024 * MB, entries: 1000, files: 1000, duration: 14400 });
});
for (const size of [50 * MB + 1, 200 * MB, 500 * MB]) {
  test(`all supported file extensions accept size metadata ${size}`, () => {
    for (const ext of AUDIO) assert.doesNotThrow(() => validateFile({ name: `media.${ext}`, size }));
    assert.doesNotThrow(() => validateFile({ name: 'VIDEO.MP4', size }));
  });
}
test('a file one byte above 500 MB is rejected with the updated limit', () => {
  assert.throws(() => validateFile({ name: 'video.mp4', size: 500 * MB + 1 }), /500 MB/);
});
test('the entire ZIP can reach 500 MB', () => {
  assert.doesNotThrow(() => validateFile({ name: 'audio.zip', size: 500 * MB }));
  assert.throws(() => validateFile({ name: 'audio.zip', size: 500 * MB + 1 }), /500 MB.*ZIP/);
});
test('empty files and unsupported extensions remain rejected', () => {
  assert.throws(() => validateFile({ name: 'audio.mp3', size: 0 }), /vazio/);
  assert.throws(() => validateFile({ name: 'audio.exe', size: 100 * MB }), /compatível/);
});
test('ZIP entry size metadata above 50 MB and up to 500 MB is accepted', async () => {
  for (const size of [50 * MB + 1, 200 * MB, 500 * MB]) {
    const inputs = await openInputs(zipFixture([{ name: 'video.mp4', size }]));
    assert.equal(inputs.entries.length, 1);
  }
});
test('ZIP entry metadata above 500 MB is rejected before extraction', async () => {
  await assert.rejects(() => openInputs(zipFixture([{ name: 'video.mp4', size: 500 * MB + 1 }])), /maior que 500 MB/);
});
test('ZIP aggregate expanded limit is 1 GB', async () => {
  await assert.rejects(() => openInputs(zipFixture([1, 2, 3].map(i => ({ name: `${i}.mp3`, size: 350 * MB })))), /limite descompactado/);
});
test('a real stored ZIP still extracts exact bytes and validates CRC', async () => {
  const payload = Buffer.from('Conteúdo de teste de extração, não uma transcrição.');
  const inputs = await openInputs(zipFixture([{ name: 'audio.mp3', payload }]));
  assert.deepEqual(Buffer.from(await (await inputs.entries[0].read()).arrayBuffer()), payload);
});
test('unsafe ZIP paths remain rejected', async () => {
  await assert.rejects(() => openInputs(zipFixture([{ name: '../audio.mp3' }])), /inseguro/);
});
test('a 120-entry ZIP is still accepted for the existing staged workflow', async () => {
  const inputs = await openInputs(zipFixture(Array.from({ length: 120 }, (_, i) => ({ name: `${i + 1}.mp3`, payload: Buffer.from('test') }))), 'name');
  assert.equal(inputs.entries.length, 120);
  assert.equal(inputs.entries[100].name, '101.mp3');
});
test('the four-hour duration guard remains enforced after decoding', async () => {
  const original = globalThis.OfflineAudioContext;
  // Controlled decoder output only; this test does not decode or transcribe a real recording.
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() { return { length: 1, duration: 14401 }; }
  };
  try { await assert.rejects(() => decodeAudio(new Blob(['test'])), /4 horas/); }
  finally {
    if (original === undefined) delete globalThis.OfflineAudioContext;
    else globalThis.OfflineAudioContext = original;
  }
});
test('the fallback interface and documentation show 500 MB and 4 h', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(html, /Cada áudio até 500 MB \/ 4 h/);
  assert.match(readme, /500 MB \/ 4 horas/);
  assert.doesNotMatch(html, /50 MB/);
  assert.doesNotMatch(readme, /50 MB/);
});
