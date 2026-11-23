import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStorage } from '../src/services/fileStorageService.js';
import { loadEnvironment } from '../src/config/env.js';
import { createAppServer } from '../src/server.js';
import { memoryCvStorage } from './cv-fixture.js';
import { openTestDatabase } from './postgres-fixture.js';

loadEnvironment();
const fixture = process.env.TEST_DATABASE_URL ? await openTestDatabase() : null;
const uploads = await mkdtemp(join(tmpdir(), 'folio-browser-uploads-'));
const server = createAppServer({
  cvStorage: memoryCvStorage(),
  projectStorage: createFileStorage(uploads),
  databaseConfig: fixture?.config,
  oauthConfig: {},
  // The database-free preview must never fall back to the application database.
  database: fixture ? undefined : {
    close: async () => {},
    findUserByEmail: async () => undefined,
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await fixture?.close();
      await rm(uploads, { recursive: true, force: true });
    });
  });
}
server.listen(Number(process.env.PORT) || 3100, '127.0.0.1');
