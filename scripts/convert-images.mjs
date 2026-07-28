// Конвертация фото public/images/**/*.png → .webp (q80) + перенос PNG-оригиналов
// в assets-src/originals-png/ (в dist не попадают). Полноэкранные фото clinic/*
// ужимаются до 1600px по ширине. Запуск: node scripts/convert-images.mjs
import sharp from 'sharp';
import { readdir, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'public/images';
const ORIGINALS = 'assets-src/originals-png';
const FULLSCREEN_MAX_W = 1600; // clinic/* — единственные фото «во весь экран»

async function* pngs(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* pngs(p);
    else if (e.name.endsWith('.png')) yield p;
  }
}

for await (const file of pngs(SRC)) {
  const out = file.replace(/\.png$/, '.webp');
  const isFullscreen = file.includes(`clinic${path.sep}`);
  let img = sharp(file);
  const { width } = await img.metadata();
  if (isFullscreen && width > FULLSCREEN_MAX_W) img = img.resize({ width: FULLSCREEN_MAX_W });
  const { size } = await img.webp({ quality: 80 }).toFile(out);

  const backup = path.join(ORIGINALS, path.relative(SRC, file));
  await mkdir(path.dirname(backup), { recursive: true });
  await rename(file, backup);
  console.log(`${path.relative(SRC, out)}  ${(size / 1024).toFixed(0)} KB`);
}
