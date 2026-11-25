import { createFileStorage } from './fileStorageService.js';
import { createSupabaseProjectStorage } from './supabaseProjectStorage.js';

export function createProjectStorage(env = process.env) {
  const driver = env.PROJECT_STORAGE_DRIVER ||
    (env.NODE_ENV === 'production' || env.SUPABASE_URL || env.SUPABASE_STORAGE_KEY ? 'supabase' : 'local');
  if (driver === 'supabase') return createSupabaseProjectStorage(env);
  if (driver === 'local') return createFileStorage(env.PROJECT_UPLOAD_DIR);
  throw new Error('PROJECT_STORAGE_DRIVER must be supabase or local.');
}
