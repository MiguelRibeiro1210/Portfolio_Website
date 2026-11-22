import { loadEnvironment } from '../src/config/env.js';
import { createAppServer } from '../src/server.js';
import { openTestDatabase } from './postgres-fixture.js';

loadEnvironment();
const fixture = process.env.TEST_DATABASE_URL ? await openTestDatabase() : null;
const server = createAppServer({
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
    });
  });
}
server.listen(Number(process.env.PORT) || 3100, '127.0.0.1');
