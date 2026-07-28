#!/usr/bin/env node
/**
 * Автопроверка дизайн-правил КТМ.
 * Запуск:  node .claude/skills/design-system/scripts/check-design.mjs
 *          node .claude/skills/design-system/scripts/check-design.mjs --json
 *
 * Ловит машинно-проверяемые правила из references/checklist.md.
 * Правила «на глаз» (одинаковость плашек в ряду, мера после снятия плашки,
 * роли ступеней шкалы, длина фразы под <mark>) скрипт НЕ проверяет — они в чек-листе.
 *
 * Код возврата: 0 — нарушений нет, 1 — есть.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');

// ── файлы, которые проверяем ────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(astro|css)$/.test(p)) acc.push(p);
  }
  return acc;
}

// /tokens — служебная витрина: там демо-значения допустимы
const isShowcase = (f) => f.endsWith(`${sep}tokens.astro`);
const isTokens = (f) => /tokens\.(base|semantic)\.css$/.test(f);
const isGlobal = (f) => f.endsWith(`${sep}global.css`);

// ── правила ────────────────────────────────────────────────────────────────
// where: 'pages' — только страницы/компоненты (не токены, не global.css)
const RULES = [
  {
    id: '1.1 жирность в наборном тексте',
    where: 'pages',
    re: /<(b|strong)>(?![^<]{0,80}<\/\1>\s*<(span|p|div))/g,
    test: (line) => /<p[^>]*>[^<]*<(b|strong)>/.test(line) || /<li>\s*<(b|strong)>/.test(line),
    hint: 'убрать выделение или обернуть фразу в <mark>; заголовок элемента — h3/h4',
  },
  {
    id: '1.1 жирность через CSS в абзацах',
    where: 'pages',
    re: /\.[\w-]*(lead|prose|para|callout|text|body|note|answer|quote)[\w-]*\s+(b|strong|em)\s*\{[^}]*font-weight\s*:\s*(600|700|bold)/g,
    hint: 'снять правило: плотность набора одна, выделение — только <mark>',
  },
  {
    id: '1.4 капс',
    where: 'all',
    re: /text-transform\s*:\s*uppercase/g,
    hint: 'капс запрещён нигде',
  },
  {
    id: '1.4 italic',
    where: 'all',
    re: /font-style\s*:\s*italic/g,
    hint: 'italic запрещён; акцентное слово — .i-serif (Lora, прямое)',
  },
  {
    id: '2.2 мера на контейнере, а не на текстовом элементе',
    where: 'pages',
    re: /max-width\s*:\s*var\(--measure-/g,
    // ОК: мера на текстовом элементе (h1-h6, p, li) или на классе с текстовой ролью.
    // НАРУШЕНИЕ: мера на обёртке — .sec-head, .faq-in, .*-inner и подобных.
    allow: (line) =>
      /(h[1-6]|\bp\b|\bli\b|dd|figcaption)[^{]*\{[^}]*max-width\s*:\s*var\(--measure-/.test(line) ||
      /\.[\w-]*(title|lead|text|para|note|sub|intro|outro|-q\b|col|answer|result|desc|caption|prose|about|fio)[\w-]*[^{]*\{[^}]*max-width\s*:\s*var\(--measure-/.test(line),
    hint: 'ch считается от кегля: мера — на самом h2/p, не на обёртке-контейнере',
  },
  {
    id: '2.6 мера процентами',
    where: 'pages',
    re: /max-width\s*:\s*\d+%/g,
    hint: 'проценты считаются от случайного родителя — мера только в ch токеном',
  },
  {
    id: '2.6 мера в px/em вместо знаков',
    where: 'pages',
    re: /max-width\s*:\s*(7[0-9][0-9]|8[0-9][0-9]|9[0-9][0-9]|1[0-9]{3})px|max-width\s*:\s*[4-9][0-9]em/g,
    hint: '720px/60em = 84–125 знаков в строке; использовать --measure-* / --tile-*',
  },
  {
    id: '3.1 хардкод кегля',
    where: 'pages',
    re: /font-size\s*:\s*(\d|clamp\()/g,
    hint: 'кегль только токеном шкалы (--fs-*), свой clamp() не писать',
  },
  {
    id: '4.1 полупрозрачная/стеклянная плашка',
    where: 'pages',
    re: /backdrop-filter|background\s*:\s*rgba\((?!10,\s*13,\s*18|255,\s*255,\s*255,\s*0\.0)/g,
    hint: 'плашек два вида: градиентная или чисто белая; прозрачности нет',
  },
  {
    id: '4.1 ледяной однотон как фон плашки',
    where: 'pages',
    re: /\.[\w-]*(tile|card|callout|block|panel|glass)[\w-]*[^{]*\{[^}]*(background|background-color)\s*:\s*var\(--tile-(teal|blue|violet|pink)\)/g,
    // чипы, метки и иконки-подложки шага плана — не плашки
    allow: (line) => /(chip|cat|badge|is-last|ic|thumb)/.test(line),
    hint: 'третьего вида плашек нет: либо --g-uni-* градиент, либо --surface-card',
  },
  {
    id: '4.3 hover меняет плашку',
    where: 'pages',
    re: /:hover[^{]*\{[^}]*transform\s*:\s*translate/g,
    // меню-дропдаун и чипы двигать/красить можно, карточку-плашку — нет
    allow: (line) => /\.(drop|nav|chip|fchip|dir|a11y|link-chip|reveal)/.test(line),
    hint: 'hover карточки красит только ссылку/заголовок внутри, без сдвига',
  },
  {
    id: '5.1 обводка на кнопке',
    where: 'pages',
    re: /\.btn[\w-]*[^{]*\{[^}]*border\s*:\s*[^0]/g,
    hint: 'кнопки — только заливка; обводок нет нигде',
  },
  {
    id: '5.1 дубль стилей кнопок в странице',
    where: 'pages',
    re: /^\s*\.btn(-dark|-light|-ice|-mini|-ghost)?\s*\{[^}]*(background|border-radius|font-size|padding\s*:)/gm,
    hint: 'единственный источник стилей кнопок — global.css (локально можно только раскладку)',
  },
  {
    id: '5.2 чип с заливкой И обводкой',
    where: 'pages',
    // чип либо контурный (норма), либо это уже не чип. Заливка + обводка = третий вид,
    // которого в системе нет. Активное состояние чипа (заливка --cta-fill) — исключение.
    re: /\.[\w-]*(chip|tag|badge|label)[\w-]*[^{]*\{(?=[^}]*border\s*:\s*1px)[^}]*background\s*:\s*var\(--(?!cta-fill)/g,
    hint: 'чипы контурные: убрать заливку (активное состояние — заливка --cta-fill без обводки)',
  },
  {
    id: '6.1 буллиты',
    where: 'pages',
    re: /list-style\s*:\s*(disc|circle|square|decimal|lower-|upper-)|::marker|li::before\s*\{[^}]*border-radius/g,
    hint: 'буллитов нет; перечисление держит вертикальный ритм',
  },
  {
    id: '6.1 разделительная линия между пунктами',
    where: 'pages',
    re: /\.(faq-item|[\w-]*(step|item|row|list li|card))[^{]*\{[^}]*border-(top|bottom)\s*:\s*1px/g,
    hint: 'линии между пунктами запрещены (кроме таблиц, шапки, футера)',
  },
  {
    id: '6.2 аккордеон в FAQ',
    where: 'pages',
    re: /<details|<summary|details\[open\]/g,
    hint: 'FAQ — статичный список (паттерн Faq.astro), аккордеонов нет',
  },
  {
    id: '7.2 плашка под иконкой',
    where: 'pages',
    re: /\.[\w-]*(ic|icon|arrow|thumb)\b[^{]*\{[^}]*(background\s*:\s*var\(--(veil|surface|tile|c-wash)|border\s*:\s*1px)/g,
    hint: 'иконка без контейнера: размер задаёт svg, фона и рамки нет',
  },
  {
    id: '8.1 центровка текста',
    where: 'pages',
    re: /text-align\s*:\s*center/g,
    // круглая плашка-отзыв — утверждённая форма: текст центрован по кругу
    allow: (line) => /compliance|uk-|dots|btn|chip|table th|map-stub|story-circle/.test(line),
    hint: 'всё по левому краю; исключение — нормативная плашка',
  },
  {
    id: '9.1 hex в странице',
    where: 'pages',
    re: /#[0-9a-fA-F]{3,6}\b/g,
    allow: (line) => /rgba|#fff\b|#ffffff|scrim|linear-gradient\(\s*to top|--/.test(line),
    hint: 'цвета — семантическими токенами',
  },
  {
    id: '9.1 хардкод радиуса',
    where: 'pages',
    re: /border-radius\s*:\s*(?!var\()(?!0)(?!50%)[\d.]+(px|%)/g,
    hint: 'радиусы — var(--r-pill|--r-card|--r-glass|--r-input|--r-sm)',
  },
];

// ── прогон ─────────────────────────────────────────────────────────────────
const findings = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const scope = isTokens(file) || isGlobal(file) ? 'infra' : 'pages';

  let selector = ''; // селектор текущего CSS-блока — для многострочных правил
  lines.forEach((line, i) => {
    if (line.includes('{')) {
      const sel = line.slice(0, line.indexOf('{')).trim();
      // @media/@supports — не селектор, наследуем предыдущий
      if (sel && !sel.startsWith('@')) selector = sel;
    }
    // комментарии не проверяем: в них правила описаны словами
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*(\/\/|\*|<!--).*/, '');
    if (!code.trim() || !code.includes(':')) return; // строки без декларации не проверяем
    // @media/@supports — служебные ширины, не мера строки; маски — не цвета
    if (/^\s*@(media|supports)/.test(code) || /mask-image/.test(code)) return;
    // строки-комментарии (в них правила описаны словами и цитируются нарушения)
    if (/^\s*(\/\*|\*|\/\/|<!--)/.test(line) || (line.includes('/*') && !line.includes('*/'))) return;

    for (const rule of RULES) {
      if (rule.where === 'pages' && scope !== 'pages') continue;
      if (isShowcase(file) && rule.where === 'pages') continue;
      const ctx = code.includes('{') ? code : `${selector} { ${code}`;
      if (rule.allow?.(ctx)) continue;
      if (rule.test ? !rule.test(ctx) : !new RegExp(rule.re.source).test(ctx)) continue;

      findings.push({
        rule: rule.id,
        file: rel.split(sep).join('/'),
        line: i + 1,
        code: code.trim().slice(0, 120),
        hint: rule.hint,
      });
    }
  });
}

// ── вывод ──────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify(findings, null, 2));
} else if (findings.length === 0) {
  console.log('✓ Нарушений машинно-проверяемых правил нет.');
  console.log('  Правила «на глаз» — в references/checklist.md (плашки в ряду, мера после');
  console.log('  снятия плашки, роли ступеней шкалы, длина фразы под <mark>).');
} else {
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  console.log(`Найдено нарушений: ${findings.length} в ${byRule.size} правилах\n`);
  for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`■ ${rule} — ${list.length}`);
    console.log(`  → ${list[0].hint}`);
    for (const f of list.slice(0, 8)) console.log(`    ${f.file}:${f.line}  ${f.code}`);
    if (list.length > 8) console.log(`    … и ещё ${list.length - 8}`);
    console.log('');
  }
  console.log('Правила «на глаз» — в references/checklist.md.');
}

process.exit(findings.length ? 1 : 0);