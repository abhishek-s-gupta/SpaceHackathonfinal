import './env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './app.js';

const port = Number(process.env.PORT || 3001);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*path', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Aegis local API listening on http://127.0.0.1:${port}`);
});
