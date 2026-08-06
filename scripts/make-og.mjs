/* ============================================================
   Пересборка og-картинки — public/og.png (1200×630).

   Картинку рисует сам сайт: макет scripts/og-preview.astro на реальных
   шрифтах и токенах проекта, дальше — скриншот. Так og не расходится
   с дизайном, когда меняются шрифт, градиент или название.

   Почему скриншотом, а не sharp: в макете живой текст в Lora и Manrope,
   а SVG-рендер sharp системных шрифтов проекта не знает.

   Запуск (dev-сервер должен быть поднят):
     npx astro dev --port 4336 --host 127.0.0.1
     node scripts/make-og.mjs --port 4336

   Макет временно копируется в src/pages/og-preview.astro и удаляется
   после съёмки — лишней страницы в сборке не остаётся.
   ============================================================ */
import { chromium } from 'playwright';
import { copyFile, rm } from 'node:fs/promises';

const portArg = process.argv.indexOf('--port');
const port = portArg > -1 ? process.argv[portArg + 1] : '4330';
const SRC = 'scripts/og-preview.astro';
const TMP = 'src/pages/og-preview.astro';
const OUT = 'public/og.png';

await copyFile(SRC, TMP);
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(`http://127.0.0.1:${port}/og-preview`, { waitUntil: 'networkidle' });
  // Панель dev-тулбара Astro попадает в кадр тёмной плашкой внизу
  await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log(`✓ ${OUT} пересобран (1200×630)`);
} finally {
  await rm(TMP, { force: true });
}
