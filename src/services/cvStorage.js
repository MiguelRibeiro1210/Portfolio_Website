import { createClient } from '@supabase/supabase-js';
import { cvError } from '../domain/cvRules.js';

export function createCvStorage(env = process.env) {
  let bucket;

  function storage() {
    if (!bucket) {
      if (!env.SUPABASE_URL || !env.SUPABASE_STORAGE_KEY) {
        throw cvError('CV file storage is not configured.', 503);
      }
      const client = createClient(env.SUPABASE_URL, env.SUPABASE_STORAGE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      bucket = client.storage.from('cv-files');
    }
    return bucket;
  }

  return {
    async upload(key, buffer) {
      const { error } = await storage().upload(key, buffer, {
        contentType: 'application/pdf', upsert: false,
      });
      if (error) throw cvError('Could not store the PDF. Try again.', 503);
    },
    async read(key) {
      const { data, error } = await storage().download(key, {}, { signal: AbortSignal.timeout(15000) });
      if (error) throw cvError('The PDF is temporarily unavailable.', 503);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(key) {
      const { error } = await storage().remove([key]);
      if (error) throw error;
    },
  };
}
