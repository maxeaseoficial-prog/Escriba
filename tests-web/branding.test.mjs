import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('web/index.html', root), 'utf8');
const css = await readFile(new URL('web/browser.css', root), 'utf8');

test('header uses the approved local wordmark instead of the old icon and text', () => {
  const header = html.match(/<header class="header">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.match(header, /aria-label="Escriba, início"/);
  assert.match(header, /<img class="brand-logo" src="\/assets\/escriba-logo\.webp" alt="Escriba" width="352" height="115"/);
  assert.doesNotMatch(header, /brand-icon|brand-dot/);
  assert.match(header, /id="open-settings"/);
});

test('wordmark asset is present in the web directory as a nonempty WebP', async () => {
  const image = await readFile(new URL('web/assets/escriba-logo.webp', root));
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  assert.ok(image.byteLength > 1000 && image.byteLength < 50000);
});

test('wordmark scales without distortion at desktop and narrow mobile sizes', () => {
  assert.match(css, /\.brand-logo\{[^}]*width:176px;[^}]*height:auto;/);
  assert.match(css, /@media\(max-width:650px\)\{\.brand-logo\{width:144px\}\}/);
  assert.match(css, /@media\(max-width:360px\)\{\.brand-logo\{width:128px\}\}/);
});
