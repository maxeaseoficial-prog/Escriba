'use strict';
const $ = (id) => document.getElementById(id);
const defaults = { output: 'pdf', language: 'pt', organized: true, timestamps: false, order: 'date' };
let preferences = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem('escriba.preferences') || '{}');
  for (const key of Object.keys(defaults)) {
    const allowed = {output: ['pdf','txt'], language: ['pt','auto','en','es'], order: ['date','name','archive']}[key];
    if (allowed ? allowed.includes(saved[key]) : typeof saved[key] === 'boolean') preferences[key] = saved[key];
  }
} catch { /* Private browsing or invalid preferences: use defaults. */ }
let file = null, jobId = null, job = null, busy = false, uploadRequest = null, pollTimer = null, token = '';
let maxBytes = 500 * 1024 * 1024, engineReady = false, connected = false, pollFailures = 0, toastTimer;
const terminal = new Set(['completed','partial','failed','cancelled']);
const extensions = new Set(['mp3','wav','m4a','ogg','opus','flac','aac','aiff','aif','wma','webm','mp4','zip']);
function message(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function headers() { return { 'X-Escriba-Client': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }; }
function rememberJob(id) { try { id ? sessionStorage.setItem('escriba.job', id) : sessionStorage.removeItem('escriba.job'); } catch {} }
function setBusy(value) {
  busy = value;
  $('choose-file').disabled = value; $('remove-file').disabled = value; $('document-title').disabled = value;
  $('transcribe').disabled = value || !file || !connected || !engineReady;
  $('cancel-job').disabled = false;
}
function outputLabel() { $('output-label').textContent = preferences.output === 'pdf' ? 'Documento PDF' : 'Arquivo de texto'; }
function openSettings() {
  const form = $('settings-form');
  form.elements.output.value = preferences.output;
  for (const name of ['language','order']) form.elements[name].value = preferences[name];
  for (const name of ['organized','timestamps']) form.elements[name].checked = preferences[name];
  $('access-token').value = token;
  $('settings-dialog').showModal();
}
$('open-settings').addEventListener('click', openSettings);
$('output-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  preferences = { output: data.get('output'), language: data.get('language'), order: data.get('order'), organized: data.has('organized'), timestamps: data.has('timestamps') };
  token = $('access-token').value.trim();
  try { localStorage.setItem('escriba.preferences', JSON.stringify(preferences)); } catch {}
  outputLabel(); $('settings-dialog').close();
  toast(busy || job ? 'Preferências salvas para a próxima transcrição.' : 'Configurações salvas.');
  if (jobId && !job) { clearTimeout(pollTimer); poll(); }
});
function selectFile(chosen) {
  if (busy || !chosen) return;
  if (!extensions.has(chosen.name.split('.').pop().toLowerCase())) { message('Formato não aceito. Selecione um áudio ou um ZIP.'); return; }
  if (!chosen.size) { message('O arquivo está vazio.'); return; }
  if (chosen.size > maxBytes) { message(`O arquivo ultrapassa ${Math.round(maxBytes / 1024 / 1024)} MB. Divida-o em partes menores.`); return; }
  file = chosen; message('');
  $('selected-file').hidden = false; $('file-name').textContent = file.name;
  $('file-size').textContent = `${(file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB · Pronto para transcrever`;
  if (!$('document-title').value) $('document-title').value = file.name.replace(/\.[^.]+$/, '').slice(0,120);
  setBusy(false);
}
$('choose-file').addEventListener('click', () => { $('file-input').value = ''; $('file-input').click(); });
$('file-input').addEventListener('change', (event) => selectFile(event.target.files[0]));
$('remove-file').addEventListener('click', () => { file = null; $('file-input').value = ''; $('selected-file').hidden = true; setBusy(false); });
for (const name of ['dragenter','dragover']) $('dropzone').addEventListener(name, (event) => { event.preventDefault(); if (!busy) $('dropzone').classList.add('dragover'); });
for (const name of ['dragleave','drop']) $('dropzone').addEventListener(name, (event) => { event.preventDefault(); $('dropzone').classList.remove('dragover'); });
$('dropzone').addEventListener('drop', (event) => {
  if (event.dataTransfer.files.length > 1) message('Para enviar vários áudios de uma vez, reúna-os em um único ZIP.');
  else selectFile(event.dataTransfer.files[0]);
});
// Prevent dropped files outside the drop zone from replacing the app in the browser.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
async function api(path, options = {}) {
  const response = await fetch(path, {...options, headers: {...headers(), ...options.headers}});
  if (!response.ok) {
    let text = `O servidor respondeu com erro ${response.status}.`;
    try { const result = await response.json(); if (typeof result.detail === 'string') text = result.detail; } catch {}
    const error = new Error(text); error.status = response.status; throw error;
  }
  return response;
}
function setProgress(value, text, current = '') {
  $('progress-area').hidden = false; $('progress-message').textContent = text; $('current-file').textContent = current;
  if (value === null) { $('progress-bar').removeAttribute('value'); $('progress-value').textContent = ''; }
  else { $('progress-bar').value = value; $('progress-value').textContent = `${Math.round(value)}%`; }
}
$('transcribe').addEventListener('click', async () => {
  if (!file || busy) return;
  clearTimeout(pollTimer); job = null; jobId = null; rememberJob(null); pollFailures = 0;
  $('result').hidden = true; message(''); setBusy(true);
  setProgress(0, 'Enviando arquivo');
  const options = {...preferences, title: $('document-title').value.trim() || 'Minha transcrição'};
  const query = new URLSearchParams({filename: file.name, options: JSON.stringify(options)});
  const xhr = new XMLHttpRequest(); uploadRequest = xhr;
  xhr.open('POST', `/api/jobs?${query}`);
  for (const [key, value] of Object.entries(headers())) xhr.setRequestHeader(key, value);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.timeout = 30 * 60 * 1000;
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) setProgress(event.loaded / event.total * 100, 'Enviando arquivo');
    if (event.loaded === event.total) setProgress(null, 'Arquivo enviado. Preparando a transcrição…');
  };
  const fail = (text) => { uploadRequest = null; setBusy(false); $('progress-area').hidden = true; message(text); };
  xhr.onerror = () => fail('Não foi possível conectar ao Escriba. Confira se o servidor está em execução.');
  xhr.ontimeout = () => fail('O envio excedeu o tempo limite. Tente um arquivo menor.');
  xhr.onabort = () => fail('Envio cancelado.');
  xhr.onload = () => {
    uploadRequest = null;
    let data;
    try { data = JSON.parse(xhr.responseText); } catch { fail('Resposta inesperada do servidor.'); return; }
    if (xhr.status !== 202) { fail(typeof data.detail === 'string' ? data.detail : 'Não foi possível enviar o arquivo.'); return; }
    jobId = data.id; rememberJob(jobId); poll();
  };
  xhr.send(file);
});
async function poll() {
  if (!jobId) return;
  const id = jobId;
  try {
    const record = await (await api(`/api/jobs/${id}`)).json();
    if (id !== jobId) return;
    pollFailures = 0; job = record;
    setProgress(['queued','preparing','receiving'].includes(record.status) ? null : record.progress, record.message, record.current || '');
    if (terminal.has(record.status)) {
      setBusy(false); $('progress-area').hidden = true;
      if (record.status === 'completed' || record.status === 'partial') showResult(record);
      else message(record.message + (record.errors?.length ? ' ' + record.errors.map(e => `${e.name}: ${e.error}`).join(' · ') : ''));
      return;
    }
    setBusy(true); pollTimer = setTimeout(poll, 1300);
  } catch (error) {
    if (id !== jobId) return;
    if (error.status === 404) { jobId = null; rememberJob(null); setBusy(false); $('progress-area').hidden = true; message(error.message); return; }
    if (error.status === 401) { job = null; message(error.message); setBusy(true); return; }
    pollFailures++;
    setProgress(null, 'Conexão interrompida. Tentando reconectar…', 'O trabalho pode continuar no servidor. Não é necessário reenviar o arquivo.');
    pollTimer = setTimeout(poll, Math.min(1000 * 2 ** Math.min(pollFailures, 5), 15000));
  }
}
function showResult(record) {
  $('result').hidden = false; $('transcript').value = record.text;
  const duration = record.results.reduce((sum, item) => sum + item.duration, 0);
  $('result-meta').textContent = `${record.results.length} áudio(s) · ${Math.floor(duration / 60)} min ${Math.round(duration % 60)} s · ${record.options.language === 'auto' ? 'Idioma automático' : {pt:'Português',en:'Inglês',es:'Espanhol'}[record.options.language]}`;
  $('result-title').textContent = record.status === 'partial' ? 'Transcrição pronta, com avisos' : 'Sua transcrição está pronta';
  $('download-label').textContent = `Baixar ${record.options.output.toUpperCase()}`;
  $('download-other').textContent = `Baixar ${record.options.output === 'pdf' ? 'TXT' : 'PDF'}`;
  const notes = [];
  if (record.errors.length) notes.push(`${record.errors.length} áudio(s) não puderam ser transcritos. Eles estão identificados no final do documento.`);
  if (record.ignored.length) notes.push(`${record.ignored.length} arquivo(s) sem formato de áudio foram ignorados: ${record.ignored.slice(0, 8).join(', ')}${record.ignored.length > 8 ? '…' : ''}`);
  if (record.results.some(item => !item.text)) notes.push('Há áudio(s) sem fala identificada. Essa indicação foi incluída na transcrição.');
  $('result-warning').textContent = notes.join(' '); $('result-warning').hidden = !notes.length;
}
$('cancel-job').addEventListener('click', async () => {
  if (uploadRequest) { uploadRequest.abort(); return; }
  if (!jobId) return;
  $('cancel-job').disabled = true;
  try { await api(`/api/jobs/${jobId}/cancel`, {method:'POST'}); toast('Cancelamento solicitado. O trecho atual precisa terminar.'); }
  catch (error) { message(error.message); $('cancel-job').disabled = false; }
});
async function download(format, button) {
  if (!jobId) return;
  button.disabled = true;
  try {
    const response = await api(`/api/jobs/${jobId}/download?format=${format}`);
    const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${(job.options.title || 'transcricao').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${format}`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) { message(error.message); } finally { button.disabled = false; }
}
$('download').addEventListener('click', () => job && download(job.options.output, $('download')));
$('download-other').addEventListener('click', () => job && download(job.options.output === 'pdf' ? 'txt' : 'pdf', $('download-other')));
$('copy-text').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('transcript').value); toast('Texto copiado.'); }
  catch { $('transcript').focus(); $('transcript').select(); toast('Texto selecionado. Use Ctrl+C ou ⌘C para copiar.'); }
});
$('delete-job').addEventListener('click', async () => {
  if (!jobId || !window.confirm('Excluir esta transcrição e os arquivos de resultado do servidor? Baixe o documento antes de continuar.')) return;
  try { await api(`/api/jobs/${jobId}`, {method:'DELETE'}); jobId = null; job = null; rememberJob(null); $('result').hidden = true; toast('Transcrição excluída.'); }
  catch (error) { message(error.message); }
});
async function initialize() {
  outputLabel();
  try {
    const health = await (await fetch('/api/health')).json(); connected = true; engineReady = health.engine_installed;
    maxBytes = health.max_upload_mb * 1024 * 1024; $('size-hint').textContent = `Até ${health.max_upload_mb} MB por envio`;
    $('access-row').hidden = !health.auth_required;
    if (!engineReady) message('O painel está disponível, mas o motor de transcrição ainda precisa ser instalado. Siga o README para instalar Whisper e FFmpeg.');
    else if (health.auth_required) message('Este servidor exige uma chave de acesso. Informe-a em Configurações.');
    let previous = null; try { previous = sessionStorage.getItem('escriba.job'); } catch {}
    if (previous && /^[0-9a-f]{32}$/.test(previous)) { jobId = previous; setBusy(true); poll(); }
    else setBusy(false);
  } catch { message('O servidor Escriba está indisponível. Inicie o aplicativo e recarregue esta página.'); }
}
initialize();
