import express from 'express';
import { resolve } from 'node:path';
const app = express();
app.get('/', (_req, res) => res.redirect('/shengzhang-studio/'));
app.use('/shengzhang-studio', express.static(resolve('github-pages/docs'), { etag: false, maxAge: 0, setHeaders(res) { res.set('Cache-Control', 'no-store'); } }));
app.use((_req, res) => res.sendStatus(404));
app.listen(4322, '127.0.0.1', () => console.log('GitHub Pages path preview: http://127.0.0.1:4322/shengzhang-studio/'));
