import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.cwd(), 'THIRD_PARTY_LICENSES.md');
const target = resolve(process.cwd(), 'dist', 'THIRD_PARTY_LICENSES.md');

if (!existsSync(source)) {
  console.error('THIRD_PARTY_LICENSES.md is missing. Run npm run licenses:generate.');
  process.exit(1);
}

mkdirSync(resolve(process.cwd(), 'dist'), { recursive: true });
copyFileSync(source, target);
console.log('copied THIRD_PARTY_LICENSES.md to dist/');
