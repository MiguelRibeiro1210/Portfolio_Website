import express from 'express';
import { createSearchRouter } from './routes/search.routes.js';
import { openDatabase } from './db/database.js';
import { getDatabaseConfig, loadEnvironment, loadAuthConfig, loadOAuthConfig } from './config/env.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createCvRouter } from './routes/cv.routes.js';
import { createShowroomRouter } from './routes/showroom.routes.js';
import { createProjectRouter } from './routes/project.routes.js';
import { createProjectStorage } from './services/projectStorage.js';
import { createFeedRouter } from './routes/feed.routes.js';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
export function createAppServer({ databaseConfig, database, authConfig = loadAuthConfig(), oauthConfig = loadOAuthConfig(), projectStorage, cvStorage } = {}) {
  let pendingDatabase = database ? Promise.resolve(database) : undefined;
  const getDatabase = () => {
    pendingDatabase ??= openDatabase(databaseConfig || getDatabaseConfig()).catch(error => {
      pendingDatabase = undefined;
      throw error;
    });
    return pendingDatabase;
  };

  projectStorage ??= createProjectStorage();
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createAuthRouter(getDatabase, authConfig, oauthConfig));
  app.use('/api', createCvRouter(getDatabase, authConfig, cvStorage));
  app.use('/api/projects', createProjectRouter(getDatabase, authConfig, projectStorage));
  app.use('/api/showrooms', createShowroomRouter(getDatabase, projectStorage));
  app.use('/api/search', createSearchRouter(getDatabase));
  app.use('/api/feed', createFeedRouter(getDatabase, authConfig, projectStorage));
  app.use(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed'); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const path = resolve(root, '.' + pathname);
      if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      let file = path;
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });

  const server = createServer(app);
  server.once('close', () => {
    pendingDatabase?.then(db => db.close(), () => {}).catch(() => console.error('Unable to close the PostgreSQL pool.'));
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvironment();
  try {
    const authConfig = loadAuthConfig();
    const oauthConfig = loadOAuthConfig();
    const database = await openDatabase(getDatabaseConfig());
    const port = Number(process.env.PORT) || 3000;
    const server = createAppServer({ database, authConfig, oauthConfig });
    server.on('error', () => {
      console.error('Unable to start the HTTP server. Check PORT and whether it is already in use.');
      database.close().finally(() => { process.exitCode = 1; });
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close());
    }
    server.listen(port, '0.0.0.0', () => console.log(`folio is ready at http://localhost:${port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
