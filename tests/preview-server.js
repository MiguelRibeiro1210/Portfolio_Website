// Browser layout/preview tests deliberately need no database or credentials.
// Registration integration is tested separately against real PostgreSQL.
import { createAppServer } from '../src/server.js';

createAppServer().listen(Number(process.env.PORT) || 3100, '127.0.0.1');
