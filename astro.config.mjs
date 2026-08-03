// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Выделенный порт этого проекта — 4330 (4321 занят соседним проектом lihty).
// strictPort: при занятости порта сборка ПАДАЕТ с явной ошибкой, а не молча
// переключается/биндится мимо — чтобы закреплённая ссылка http://localhost:4330
// всегда указывала именно на KTM.
// Сайт публикуется в репозиторий nikitaa2333333.github.io и отдаётся С КОРНЯ
// (сайт пользователя, а не проектный), поэтому префикс пути не нужен: ссылки
// в исходниках корневые — `/vrachi` — и такими же уезжают на будущий домен.
const SITE = process.env.PUBLIC_SITE || undefined;

export default defineConfig({
  site: SITE,
  // Блог переехал по ТЗ на /blog (было /stati). Старый адрес мог разойтись
  // по ссылкам — держим редирект, а не 404.
  redirects: {
    '/stati': '/blog',
  },
  server: {
    port: 4330,
    host: true,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      port: 4330,
      strictPort: true,
    },
  },
});
