import { createClient } from '@supabase/supabase-js';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { detectFileType } from './fileStorageService.js';
import { isUUID, projectError } from '../domain/projectRules.js';

export const projectBucket = 'project-files';

function configuration(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_STORAGE_KEY) {
    throw new Error('Project storage requires SUPABASE_URL and SUPABASE_STORAGE_KEY.');
  }
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { /* validated below */ }
  const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SUPABASE_URL must be the HTTPS project origin.');
  }
  return { url: url.origin, key: env.SUPABASE_STORAGE_KEY };
}

function storageClient(env) {
  const { url, key } = configuration(env);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, options = {}) => fetch(input, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    }) },
  });
}

export async function ensureProjectBucket(env = process.env, client = storageClient(env)) {
  const { data, error } = await client.storage.getBucket(projectBucket);
  if (!error) {
    if (data.public) throw new Error('The project-files bucket must be private.');
    return { created: false };
  }
  const status = String(error.status ?? error.statusCode);
  if (status !== '404' && !(status === '400' && /bucket.*not found/i.test(error.message ?? ''))) {
    throw new Error('Unable to inspect project-files. Check Supabase storage credentials and permissions.');
  }
  // Inherit the project's global upload limit; a bucket cannot exceed it.
  const result = await client.storage.createBucket(projectBucket, { public: false });
  if (result.error) throw new Error('Unable to create the private project-files bucket. Check Supabase storage permissions.');
  return { created: true };
}

export function createSupabaseProjectStorage(env = process.env, { client, request = fetch } = {}) {
  const { url, key } = configuration(env);
  const bucket = (client ?? storageClient(env)).storage.from(projectBucket);
  const objectUrl = id => {
    if (!isUUID(id)) throw projectError('File not found.', 404);
    return `${url}/storage/v1/object/${projectBucket}/${encodeURIComponent(id)}`;
  };

  async function uploadFile(id, path, type) {
    objectUrl(id);
    try {
      const blob = await openAsBlob(path, { type });
      const { error } = await bucket.upload(id, blob, { contentType: type, upsert: false, cacheControl: '0' });
      if (error) throw error;
    } catch {
      throw projectError('Could not store the project file. Check the private project-files bucket and storage limits.', 503);
    }
  }

  return {
    async stage() { return mkdtemp(join(tmpdir(), 'folio-project-')); },
    async discard(stage) { await rm(stage, { recursive: true, force: true }); },
    async store(file) {
      const type = await detectFileType(file);
      const id = randomUUID();
      await uploadFile(id, file.path, type);
      return { id, name: file.originalname.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 255), type, size: file.size };
    },
    async read(id, { range, method = 'GET', signal } = {}) {
      const headers = { apikey: key };
      // New Supabase secret keys are API keys, not JWT bearer tokens.
      if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
      if (range) headers.Range = range;
      try {
        return await request(objectUrl(id), {
          method, headers, redirect: 'error', cache: 'no-store',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
        });
      } catch {
        throw projectError('Project file storage is temporarily unavailable.', 503);
      }
    },
    async remove(ids) {
      if (!ids.length) return;
      ids.forEach(objectUrl);
      const { error } = await bucket.remove(ids);
      if (error) throw projectError('Could not remove project files from storage.', 503);
    },
  };
}
