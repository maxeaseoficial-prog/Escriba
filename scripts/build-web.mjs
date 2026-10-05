import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const out = new URL('dist/', root);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(new URL('web/', root), out, { recursive: true });
await mkdir(new URL('static/', out), { recursive: true });
for (const file of ['styles.css', 'favicon.svg']) {
  await cp(new URL(`escriba/static/${file}`, root), new URL(`static/${file}`, out));
}
console.log(`Escriba estático criado em ${fileURLToPath(out)}. Sem servidor Python ou API.`);
