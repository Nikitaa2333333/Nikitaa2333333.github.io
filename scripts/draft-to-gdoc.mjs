#!/usr/bin/env node
// Черновик новой страницы → HTML для заливки клиенту в Google Docs.
//
// Обычный путь выгрузки идёт от собранного сайта: код → dist → выгрузка → документ.
// Для НОВОЙ страницы этот путь недоступен — страницы ещё нет. Здесь текст пишется
// сразу в виде выгрузки, клиника его вычитывает, и только утверждённый текст уходит
// в вёрстку. После вёрстки источник правды снова код: страница проверяется обычным
// `npm run texts` + `diff-gdoc.mjs` против утверждённого документа.
//
// Использование:
//   node scripts/draft-to-gdoc.mjs <каталог с черновиками>
//
// Черновики — файлы `NN.md` в том же формате, что и выгрузка. Рядом кладётся `NN.html`.
import fs from 'fs';
import path from 'path';
import { markdownToHtml } from './lib/gdoc-html.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/draft-to-gdoc.mjs <каталог с черновиками>');
  process.exit(2);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
if (!files.length) {
  console.error(`в ${dir} нет файлов .md`);
  process.exit(2);
}

for (const file of files) {
  const md = fs.readFileSync(path.join(dir, file), 'utf8');
  const dest = path.join(dir, file.replace(/\.md$/, '.html'));
  fs.writeFileSync(dest, markdownToHtml(md));

  const title = (md.split('\n')[0] || '').replace(/^#\s*/, '');
  console.log(`${file} → ${path.basename(dest)}  ·  ${title}`);
}
