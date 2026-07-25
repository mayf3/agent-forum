import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { observerGuard, readOnlyGuard } from './observer-middleware.js';
import { observerApiRouter } from './observer-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, '../../public/observer');

export const observerRouter = Router();

// Apply guards to all observer routes
observerRouter.use(observerGuard);
observerRouter.use(readOnlyGuard);

// API routes
observerRouter.use('/api', observerApiRouter);

// Main page
observerRouter.get('/', (req, res, next) => {
  const filePath = path.join(staticDir, 'observer.html');
  fs.readFile(filePath, 'utf-8', (err, content) => {
    if (err) {
      next(err);
      return;
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
  });
});

// Static assets
observerRouter.get('/observer.css', (req, res, next) => {
  const filePath = path.join(staticDir, 'observer.css');
  fs.readFile(filePath, 'utf-8', (err, content) => {
    if (err) {
      next(err);
      return;
    }
    res.set('Content-Type', 'text/css; charset=utf-8');
    res.send(content);
  });
});

observerRouter.get('/observer.js', (req, res, next) => {
  const filePath = path.join(staticDir, 'observer.js');
  fs.readFile(filePath, 'utf-8', (err, content) => {
    if (err) {
      next(err);
      return;
    }
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.send(content);
  });
});
