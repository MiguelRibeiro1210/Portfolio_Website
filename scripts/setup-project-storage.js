import { loadEnvironment } from '../src/config/env.js';
import { ensureProjectBucket } from '../src/services/supabaseProjectStorage.js';

loadEnvironment();
try {
  const { created } = await ensureProjectBucket();
  console.log(`Private project-files bucket ${created ? 'created' : 'verified'}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
