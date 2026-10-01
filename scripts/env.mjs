/** Shared by the scripts: read .dev.vars (gitignored), with the real environment taking priority. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadEnv() {
  const file = fileURLToPath(new URL('../.dev.vars', import.meta.url));
  const vars = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { ...vars, ...process.env };
}
