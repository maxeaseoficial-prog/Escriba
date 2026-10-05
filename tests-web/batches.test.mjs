import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, LIMITS, transcriptText } from '../web/core.js';
import { BATCH_SIZE, planBatches, batchMessage, createBatchRun, executeBatches, stageFilename } from '../web/batches.js';

const entries = count => Array.from({ length: count }, (_, i) => ({ name: `audio-${String(i + 1).padStart(3, '0')}.wav` }));
const create = (count, options = {}) => createBatchRun(entries(count), { ...DEFAULTS, ...options }, { title: 'Reunião', warnings: [], createdAt: '2026-10-05T19:00:00Z' });
// Controlled test adapter: this validates orchestration, NOT actual PDF bytes or Whisper.
const pdfAdapter = async result => ({ blob: new Blob([transcriptText(result, { organized: true })]), substitutions: 0 });
const recognize = async entry => ({ text: `Conteúdo de ${entry.name}`, chunks: [] });

for (const [count, sizes] of [[1,[1]], [99,[99]], [100,[100]], [101,[100,1]], [120,[100,20]], [200,[100,100]], [201,[100,100,1]], [250,[100,100,50]], [1000,Array(10).fill(100)]]) {
  test(`plan ${count} audio files: ${sizes.join('+')}`, () => {
    const input = entries(count), plans = planBatches(input);
    assert.deepEqual(plans.map(p => p.entries.length), sizes);
    assert.deepEqual(plans.flatMap(p => p.entries), input);
    assert.equal(plans.at(-1).last, count);
    assert.equal(plans[0].first, 1);
    assert.ok(plans.every(p => p.entries.length <= BATCH_SIZE));
  });
}
test('count and memory limits are independent of batch size', () => { assert.equal(LIMITS.files,1000); assert.equal(LIMITS.upload,200*1024**2); assert.equal(LIMITS.expanded,500*1024**2); assert.equal(LIMITS.audio,50*1024**2); assert.equal(LIMITS.duration,1800); });
test('empty and excessive plans rejected', () => { assert.throws(()=>planBatches([])); assert.throws(()=>planBatches(entries(1001))); });
test('message explicitly announces 100 and 20 with automatic continuation', () => { const message=batchMessage(120); for (const text of ['duas etapas','100 primeiros','20 restantes','automaticamente','sem reenviar']) assert.ok(message.includes(text)); });
test('more than 200 never falsely announces two stages', () => { assert.match(batchMessage(250),/3 etapas/); assert.equal(batchMessage(100),''); });
test('split runs force PDF and organization without mutating preferences', () => { const opts={...DEFAULTS,output:'txt',organized:false}; const run=createBatchRun(entries(120),opts,{title:'Teste'}); assert.equal(run.options.output,'pdf'); assert.equal(run.options.organized,true); assert.equal(opts.output,'txt'); assert.equal(opts.organized,false); });
test('single stage keeps existing TXT and unorganized preferences', () => { const run=create(100,{output:'txt',organized:false}); assert.equal(run.options.output,'txt'); assert.equal(run.options.organized,false); });
test('all 120 processed sequentially; first PDF emitted BEFORE audio 101; separate outputs', async () => {
  const run=create(120), events=[]; let active=0, maxActive=0;
  const pdfContents=[];
  await executeBatches(run, {
    transcribe: async entry => { active++; maxActive=Math.max(maxActive,active); events.push(entry.name); await Promise.resolve(); active--; return recognize(entry); },
    makePDF: async result => { events.push(`pdf-${result.batch.number}`); pdfContents.push(transcriptText(result,run.options)); return pdfAdapter(result); },
    onUpdate: stage => { if (stage.status==='completed') events.push(`ready-${stage.number}`); },
  });
  assert.equal(maxActive,1); assert.equal(events.filter(x=>x.endsWith('.wav')).length,120);
  assert.ok(events.indexOf('ready-1') < events.indexOf('audio-101.wav'));
  assert.ok(events.indexOf('pdf-1') < events.indexOf('audio-101.wav'));
  assert.deepEqual(run.stages.map(s=>s.result.items.length),[100,20]);
  assert.match(pdfContents[0],/100\. audio-100\.wav/); assert.doesNotMatch(pdfContents[0],/audio-101/);
  assert.match(pdfContents[1],/^101\. audio-101\.wav/); assert.match(pdfContents[1],/120\. audio-120\.wav/); assert.doesNotMatch(pdfContents[1],/audio-100/);
  assert.equal(run.stages[0].result.batch.totalFiles,120);
  assert.deepEqual(run.stages.map(s=>s.status),['completed','completed']);
});
test('201 audio files yield three PDFs with no empty extra stage', async () => { const run=create(201); let pdfs=0; await executeBatches(run,{transcribe:recognize,makePDF:async r=>{pdfs++;return pdfAdapter(r);}}); assert.equal(pdfs,3); assert.deepEqual(run.stages.map(s=>s.result.items.length),[100,100,1]); });
test('single stage does not force an automatic PDF download', async () => { const run=create(100,{output:'txt'}); await executeBatches(run,{transcribe:recognize,makePDF:()=>{throw new Error('not called');}}); assert.equal(run.stages[0].status,'completed'); assert.equal(run.stages[0].pdf,null); });
test('PDF failure pauses; retry does not recognize first 100 again', async () => {
  const run=create(120); const calls=[]; let fail=true;
  const deps={transcribe:async e=>{calls.push(e.name);return recognize(e);},makePDF:async r=>{if(fail)throw new Error('rede indisponível');return pdfAdapter(r);}};
  await executeBatches(run,deps);
  assert.equal(run.paused,true); assert.equal(calls.length,100);
  assert.deepEqual(run.stages.map(s=>s.status),['pdf-error','pending']);
  assert.equal(run.stages[0].result.items.length,100);
  fail=false; await executeBatches(run,deps);
  assert.equal(calls.length,120); assert.equal(new Set(calls).size,120); assert.equal(run.paused,false);
  await executeBatches(run,deps); assert.equal(calls.length,120);
});
test('empty PDF does not mark a stage successful or start second stage',async()=>{const run=create(120);await executeBatches(run,{transcribe:recognize,makePDF:async()=>({blob:new Blob([])})});assert.equal(run.stages[0].status,'pdf-error');assert.equal(run.stages[1].status,'pending');});
test('second PDF failure never removes first PDF; retry only exports remaining PDF',async()=>{const run=create(120);let calls=0;const transcribe=async e=>{calls++;return recognize(e);};await executeBatches(run,{transcribe,makePDF:async r=>{if(r.batch.number===2)throw new Error('offline');return pdfAdapter(r);}});const first=run.stages[0].pdf;await executeBatches(run,{transcribe,makePDF:pdfAdapter});assert.equal(calls,120);assert.equal(run.stages[0].pdf,first);assert.equal(run.stages[1].status,'completed');});
test('audio failure appears once in its PDF section; remaining stages continue',async()=>{const run=create(120);await executeBatches(run,{transcribe:async e=>{if(e.name==='audio-005.wav')throw new Error('Codec inválido');return recognize(e);},makePDF:pdfAdapter});assert.equal(run.stages[0].status,'partial');assert.equal(run.stages[1].status,'completed');assert.match(transcriptText(run.stages[0].result,run.options),/Não transcrito: audio-005.wav/);assert.match(stageFilename(run.stages[0]),/-parcial\.pdf$/);});
test('cancel during second stage keeps first PDF and exposes explicit partial output',async()=>{const run=create(120),c=new AbortController();let calls=0;await executeBatches(run,{signal:c.signal,transcribe:async e=>{calls++;if(calls===106)c.abort();return recognize(e);},makePDF:pdfAdapter});assert.ok(run.stages[0].pdf);assert.equal(run.stages[0].status,'completed');assert.equal(run.stages[1].status,'cancelled');assert.equal(run.stages[1].result.items.filter(i=>!i.error).length,5);assert.equal(run.stages[1].result.items.length,20);assert.equal(run.cancelled,true);assert.match(transcriptText(run.stages[1].result,run.options),/documento parcial/);assert.match(stageFilename(run.stages[1]),/parcial/);});
test('cancel at boundary never transcribes audio 101',async()=>{const run=create(120),c=new AbortController();let calls=0;await executeBatches(run,{signal:c.signal,transcribe:async e=>{calls++;return recognize(e);},makePDF:pdfAdapter,onUpdate:s=>{if(s.status==='completed')c.abort();}});assert.equal(calls,100);assert.ok(run.stages[0].pdf);assert.equal(run.stages[1].status,'cancelled');assert.equal(run.stages[1].result.items.length,0);});
test('cancel during PDF generation preserves finished PDF but stops the next stage',async()=>{const run=create(120),c=new AbortController();await executeBatches(run,{signal:c.signal,transcribe:recognize,makePDF:async r=>{c.abort();return pdfAdapter(r);}});assert.equal(run.stages[0].status,'completed');assert.ok(run.stages[0].pdf);assert.equal(run.stages[1].status,'cancelled');});
test('cancel during failed PDF generation cannot offer automatic continuation',async()=>{const run=create(120),c=new AbortController();await executeBatches(run,{signal:c.signal,transcribe:recognize,makePDF:async()=>{c.abort();throw new Error('offline');}});assert.equal(run.cancelled,true);assert.equal(run.paused,false);assert.equal(run.stages[1].status,'cancelled');});
test('already aborted request makes no transcription call',async()=>{const c=new AbortController();c.abort();await assert.rejects(()=>executeBatches(create(120),{signal:c.signal,transcribe:()=>{throw new Error('not called');}}),{name:'AbortError'});});
test('filenames are distinct and describe exact ranges',()=>{const r=create(120);assert.equal(stageFilename(r.stages[0]),'escriba-etapa-01-audios-1-100.pdf');assert.equal(stageFilename(r.stages[1]),'escriba-etapa-02-audios-101-120.pdf');});
test('PDF export contains stage metadata; global numbering continues from 101',async()=>{const code=await readFile(new URL('../web/export.js',import.meta.url),'utf8');assert.match(code,/result\.batch/);const run=create(120);run.stages[1].result.items.push({name:'test.wav',text:'Teste.'});assert.match(transcriptText(run.stages[1].result,run.options),/^101\. test.wav/);});
