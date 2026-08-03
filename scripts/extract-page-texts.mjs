/**
 * Выгрузка текстов страниц в Markdown — для сверки контента с клиникой.
 *
 * Источник — СОБРАННЫЙ сайт (dist/): текст берётся из готового HTML,
 * поэтому совпадает с тем, что видит посетитель, дословно.
 *
 * Запуск:  npm run build && node scripts/extract-page-texts.mjs
 * Результат: docs/тексты-страниц/<путь-страницы>.md (по файлу на страницу).
 *
 * Правила:
 * - главная (/) НЕ выгружается — её текст ведётся вручную в docs/тексты-главной.md
 *   (там же сквозные шапка и футер, поэтому здесь они пропускаются);
 * - /tokens — служебная витрина, пропускается;
 * - <mark>…</mark> сохраняется как есть (фирменный маркер);
 * - неразрывные пробелы заменяются обычными (типографика расставит заново);
 * - кнопки и поля форм помечаются курсивной служебной пометкой *(кнопка)* / *(поле…)*;
 * - каждая секция страницы отбивается «---» и помечается *(секция: id)* —
 *   по этой пометке правки возвращаются в код.
 *
 * parse5 — транзитивная зависимость Astro, отдельно не ставится.
 */
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'docs', 'тексты-страниц');

// страницы, которые не выгружаем (см. шапку файла)
const SKIP = new Set(['', 'tokens']);
// сквозные блоки — описаны один раз в docs/тексты-главной.md
const SKIP_IDS = new Set(['site-head', 'contacts']);
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'noscript', 'template', 'link', 'meta', 'img', 'source', 'picture', 'iframe']);
const HEADINGS = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '#####', h6: '#####' };
const INLINE = new Set(['span', 'em', 'i', 'strong', 'b', 'small', 'sup', 'sub', 'abbr', 'time', 'cite', 'u', 's', 'code']);

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? '';
const hasClass = (node, cls) => attr(node, 'class').split(/\s+/).includes(cls);

const skip = (node) =>
  SKIP_TAGS.has(node.nodeName) ||
  attr(node, 'aria-hidden') === 'true' ||
  node.attrs?.some((a) => a.name === 'hidden') ||
  SKIP_IDS.has(attr(node, 'id')) ||
  node.nodeName === 'header' && hasClass(node, 'site-head') ||
  node.nodeName === 'footer' && hasClass(node, 'foot');

const clean = (s) =>
  s
    .replace(/ /g, ' ') // nbsp → обычный пробел
    .replace(/­/g, '') // soft hyphen
    .replace(/[ \t]+/g, ' ');

/** Текст фразового содержимого узла (mark сохраняется тегом). */
function inline(node) {
  if (node.nodeName === '#text') return clean(node.value);
  if (skip(node) || !node.childNodes) return '';
  const inner = node.childNodes.map(inline).join('');
  if (node.nodeName === 'mark') {
    const t = inner.trim();
    return t ? `<mark>${t}</mark>` : '';
  }
  if (node.nodeName === 'br') return '\n';
  return inner;
}

/** Есть ли у узла блочные потомки (заголовки, абзацы и т.п.). */
const hasBlockChildren = (node) =>
  node.childNodes?.some(
    (c) => c.nodeName !== '#text'
      && !INLINE.has(c.nodeName)
      && !['mark', 'br', 'a', 'button'].includes(c.nodeName)
      // то, что выкидывается при разборе (декоративные svg-шевроны), блоком не считается —
      // иначе кнопка с иконкой выглядит как контейнер и теряет пометку *(кнопка)*
      && !skip(c),
  );

/** Markdown-блоки узла (массив готовых блоков-строк). */
function blocks(node) {
  if (node.nodeName === '#text') {
    const t = clean(node.value).trim();
    return t ? [t] : [];
  }
  if (skip(node) || !node.childNodes) return [];

  const tag = node.nodeName;

  if (HEADINGS[tag]) {
    const t = inline(node).replace(/\s+/g, ' ').trim();
    return t ? [`${HEADINGS[tag]} ${t}`] : [];
  }

  if (tag === 'p' || tag === 'figcaption' || tag === 'blockquote' || tag === 'legend' || tag === 'caption') {
    const t = inline(node).trim().replace(/[ \t]*\n[ \t]*/g, '\n');
    return t ? [t] : [];
  }

  // Плашка целиком обёрнута в ссылку (карточка с href) — внутри заголовок и абзац.
  // Схлопывать такую ссылку в строку нельзя: заголовок карточки слипнется с текстом,
  // поэтому она разбирается общей веткой контейнера ниже.
  if ((tag === 'a' || tag === 'button') && !hasBlockChildren(node)) {
    const t = inline(node).replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const cls = attr(node, 'class');
    if (/\bbtn\b/.test(cls) || tag === 'button') return [`*(кнопка)* ${t}`];
    return [t]; // самостоятельная ссылка/чип
  }

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (['hidden', 'submit'].includes(attr(node, 'type'))) return [];
    const label = attr(node, 'placeholder') || attr(node, 'aria-label') || attr(node, 'name');
    return label ? [`*(поле: ${label})*`] : [];
  }

  if (tag === 'ul' || tag === 'ol') {
    const out = [];
    for (const li of node.childNodes) {
      if (li.nodeName !== 'li' || skip(li)) continue;
      if (hasBlockChildren(li)) {
        out.push(...blocks({ ...li, nodeName: 'div' }));
      } else {
        const t = inline(li).replace(/\s+/g, ' ').trim();
        if (t) out.push(`- ${t}`);
      }
    }
    // подряд идущие пункты «- …» склеиваются в один блок-список
    const merged = [];
    for (const b of out) {
      if (b.startsWith('- ') && merged.length && merged[merged.length - 1].startsWith('- ')) {
        merged[merged.length - 1] += `\n${b}`;
      } else merged.push(b);
    }
    return merged;
  }

  if (tag === 'table') {
    const rows = [];
    const walkRows = (n) => {
      if (n.nodeName === 'tr') {
        const cells = n.childNodes
          .filter((c) => c.nodeName === 'td' || c.nodeName === 'th')
          .map((c) => inline(c).replace(/\s+/g, ' ').trim());
        if (cells.some(Boolean)) rows.push(cells);
      } else n.childNodes?.forEach(walkRows);
    };
    walkRows(node);
    if (!rows.length) return [];
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    const [head, ...rest] = rows;
    return [[line(head), `|${' --- |'.repeat(width)}`, ...rest.map(line)].join('\n')];
  }

  if (INLINE.has(tag) || tag === 'mark' || tag === 'label') {
    const t = inline(node).replace(/\s+/g, ' ').trim();
    return t ? [t] : [];
  }

  // хлебные крошки — одной служебной строкой
  if (tag === 'nav' && hasClass(node, 'crumbs')) {
    const items = node.childNodes.flatMap(blocks).filter(Boolean);
    return items.length ? [`*(хлебные крошки)* ${items.join(' · ')}`] : [];
  }

  // контейнер только с фразовым содержимым (например, цифра + подпись) — один абзац
  const onlyPhrasing = node.childNodes.every(
    (c) => c.nodeName === '#text' || INLINE.has(c.nodeName) || c.nodeName === 'mark' || c.nodeName === 'br',
  );
  if (onlyPhrasing) {
    const t = inline(node).replace(/\s+/g, ' ').trim();
    return t ? [t] : [];
  }

  // прочие контейнеры (div, section, article, form, …) — просто собираем детей
  return node.childNodes.flatMap(blocks);
}

/** Ищет первый узел по предикату. */
function find(node, pred) {
  if (pred(node)) return node;
  for (const c of node.childNodes ?? []) {
    const r = find(c, pred);
    if (r) return r;
  }
  return null;
}

function extractPage(html, rel) {
  const doc = parse(html);
  const body = find(doc, (n) => n.nodeName === 'body');
  const title = find(doc, (n) => n.nodeName === 'title');
  const titleText = title ? inline(title).trim() : rel;

  // секции верхнего уровня отбиваем «---» и помечаем id
  const parts = [];
  for (const child of body.childNodes) {
    if (skip(child)) continue;
    const isSection = child.nodeName === 'section' || child.nodeName === 'main' || child.nodeName === 'article';
    const bs = blocks(child);
    if (!bs.length) continue;
    if (isSection) {
      const id = attr(child, 'id');
      parts.push(['---', id ? `*(секция: ${id})*` : null, ...bs].filter(Boolean).join('\n\n'));
    } else {
      parts.push(bs.join('\n\n'));
    }
  }

  return { title: titleText, body: parts.join('\n\n') };
}

/** Понижает уровень всех заголовков Markdown на n ступеней (для сводного файла). */
const demote = (md, n = 1) =>
  md.replace(/^(#{1,6}) /gm, (_, h) => `${'#'.repeat(Math.min(6, h.length + n))} `);

// — обход dist/ —
if (!fs.existsSync(DIST)) {
  console.error('dist/ не найден — сначала npm run build');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const found = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'index.html') found.push(path.relative(DIST, dir));
  }
})(DIST);

// порядок страниц — как в меню сайта; незнакомые страницы уезжают в конец
const ORDER = [
  's-chego-nachat',
  'molekulyarnaya-diagnostika',
  'biopsiya',
  'onkomarkery',
  'lechenie',
  'lechenie/himioterapiya',
  'vrachi',
  'vrachi/orlov-sergey-vladimirovich',
  'vrachi/imyanitov-evgeniy-naumovich',
  'vrachi/levchenko-nikita-evgenievich',
  'stoimost',
  'stati',
  'litsenzii',
];
const rank = (rel) => (ORDER.indexOf(rel) === -1 ? ORDER.length : ORDER.indexOf(rel));
const pages = found
  .filter((rel) => !SKIP.has(rel))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const NOTES = [
  '- `<mark>…</mark>` — фирменное выделение фразы маркером;',
  '- `[X]`, `[уточняется у клиники]` — видимые заглушки, данных от клиники нет;',
  '- курсив в скобках — служебная пометка (кнопка, поле, id секции), к тексту не относится.',
];

const collected = [];
for (const rel of pages) {
  const html = fs.readFileSync(path.join(DIST, rel, 'index.html'), 'utf8');
  const { title, body } = extractPage(html, rel);
  collected.push({ rel, title, body });

  const preamble = [
    `# ${title}`,
    '',
    `Страница \`/${rel}/\` — весь видимый текст в порядке появления на экране.`,
    'Файл сгенерирован скриптом `scripts/extract-page-texts.mjs` из собранного сайта —',
    'НЕ редактировать вручную: правки вносятся в код страницы, затем выгрузка обновляется.',
    '',
    'Пометки:',
    '',
    '- сквозные шапка и футер здесь опущены — они описаны в `docs/тексты-главной.md`;',
    ...NOTES,
    '',
  ].join('\n');

  const cleanRel = rel.replace(/\\/g, '-').replace(/\//g, '-');
  const outFile = path.join(OUT, `${cleanRel}.md`);
  fs.writeFileSync(outFile, `${preamble}\n${body}\n`);
  console.log(`✓ ${rel.padEnd(40)} → ${path.relative(ROOT, outFile)}`);
}

// — сводный файл для клиники (из него делается Google Doc) —
const HOME = path.join(ROOT, 'docs', 'тексты-главной.md');
const combined = [
  '# Тексты сайта — на сверку',
  '',
  'Клиника трансляционной медицины. Весь видимый текст сайта: главная и все внутренние',
  'страницы, в порядке меню. Текст выгружен из собранного сайта — он дословно совпадает',
  'с тем, что видит посетитель.',
  '',
  'Как читать и править:',
  '',
  '- правьте прямо в этом документе — текстом или комментариями, как удобнее;',
  '- заголовки документа повторяют заголовки страниц, порядок блоков — порядок экранов;',
  '- `*(секция: …)*` — техническая метка блока, по ней правка возвращается в вёрстку;',
  '  её саму править не нужно;',
  ...NOTES,
  '- шапка и футер сквозные — они описаны один раз, в разделе «Главная страница».',
  '',
];

if (fs.existsSync(HOME)) {
  // у файла главной своя техническая преамбула (до первого «---») — в клиентский документ
  // она не идёт: пометки уже описаны выше, одинаково для всех страниц
  const raw = fs.readFileSync(HOME, 'utf8');
  const home = raw.includes('\n---\n') ? raw.slice(raw.indexOf('\n---\n') + 5) : raw.replace(/^#[^\n]*\n/, '');
  combined.push('---', '', '# Главная страница', '', demote(home).trim(), '');
}

for (const { rel, title, body } of collected) {
  combined.push('---', '', `# ${title.split('—')[0].trim()} — страница /${rel}/`, '', demote(body).trim(), '');
}

const combinedFile = path.join(OUT, 'ВСЕ-ТЕКСТЫ-САЙТА.md');
fs.writeFileSync(combinedFile, `${combined.join('\n')}\n`);

console.log(`\nГотово: ${collected.length} страниц в ${path.relative(ROOT, OUT)}/`);
console.log(`Сводный файл: ${path.relative(ROOT, combinedFile)}`);

import { markdownToHtml } from './lib/gdoc-html.mjs';

// — режим `--gdoc <каталог>`: клиентские версии для заливки в Google Docs —
// Отличие от файлов репозитория — преамбула: клиент правит документ, а не код.
// Каталог временный (в git не хранится), рядом кладётся manifest.json с названиями.
const gdocFlag = process.argv.indexOf('--gdoc');
if (gdocFlag !== -1) {
  const dir = process.argv[gdocFlag + 1];
  if (!dir) {
    console.error('--gdoc требует каталог назначения');
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });

  const CLIENT_NOTE = [
    'Правьте прямо в этом документе — текстом или комментариями, как удобнее.',
    '',
    '- `*(секция: …)*` — техническая метка блока, по ней правка возвращается в вёрстку;',
    '  её саму править не нужно;',
    ...NOTES,
    '- шапка и футер сквозные — они в документе «01 · Главная».',
    '',
  ].join('\n');

  // человеческие названия документов — в порядке меню
  const NAMES = {
    '': 'Главная',
    's-chego-nachat': 'С чего начать',
    'molekulyarnaya-diagnostika': 'Молекулярно-генетические исследования',
    biopsiya: 'Биопсия и гистология',
    onkomarkery: 'Онкомаркеры',
    lechenie: 'Как выбирается метод лечения',
    'lechenie/himioterapiya': 'Химиотерапия',
    'lechenie/targetnaya-terapiya': 'Таргетная терапия',
    'lechenie/immunoterapiya': 'Иммунотерапия',
    vrachi: 'Врачи',
    'vrachi/orlov-sergey-vladimirovich': 'Орлов Сергей Владимирович',
    'vrachi/imyanitov-evgeniy-naumovich': 'Имянитов Евгений Наумович',
    'vrachi/levchenko-nikita-evgenievich': 'Левченко Никита Евгеньевич',
    stoimost: 'Цены',
    stati: 'Статьи',
    litsenzii: 'Лицензия и сведения о клинике',
  };

  // главная идёт первым документом — её текст ведётся вручную
  const items = [];
  if (fs.existsSync(HOME)) {
    const raw = fs.readFileSync(HOME, 'utf8');
    const bodyHome = raw.includes('\n---\n') ? raw.slice(raw.indexOf('\n---\n') + 5) : raw;
    items.push({ rel: '', body: bodyHome.trim() });
  }
  items.push(...collected.map(({ rel, body }) => ({ rel, body })));

  const manifest = items.map((it, i) => {
    const n = String(i + 1).padStart(2, '0');
    const name = NAMES[it.rel] ?? it.rel;
    const title = `${n} · ${name} · /${it.rel}${it.rel ? '/' : ''}`;
    const file = path.join(dir, `${n}.md`);
    const md = `# ${name}\n\nСтраница сайта \`/${it.rel}${it.rel ? '/' : ''}\`\n\n${CLIENT_NOTE}\n${it.body}\n`;
    fs.writeFileSync(file, md);

    const htmlFile = path.join(dir, `${n}.html`);
    fs.writeFileSync(htmlFile, markdownToHtml(md));

    return { file: path.resolve(file), html: path.resolve(htmlFile), title };
  });

  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nКлиентские версии для Google Docs: ${manifest.length} шт. в ${dir}`);
}
