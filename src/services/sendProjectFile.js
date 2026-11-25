import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { projectError } from '../domain/projectRules.js';

// Every caller checks ownership/publication before reaching storage.
export async function sendProjectFile(req, res, storage, file, { etag = false } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    if (!storage.read) {
      await new Promise((resolve, reject) => {
        res.sendFile(storage.path(file.id), { cacheControl: false, lastModified: false, etag }, error => error ? reject(error) : resolve());
      });
      return;
    }
    const response = await storage.read(file.id, { range: req.get('Range'), method: req.method, signal: controller.signal });
    if (response.status === 416) {
      const range = response.headers.get('content-range');
      if (range) res.set('Content-Range', range);
      await response.body?.cancel();
      throw projectError('Invalid file range.', 416);
    }
    if (!response.ok) {
      // Storage sometimes reports an absent object as HTTP 400 with statusCode 404.
      const error = await response.json().catch(() => ({}));
      const missing = (response.status === 404 || Number(error.statusCode) === 404) &&
        error.code !== 'NoSuchBucket' && !/bucket/i.test(error.message ?? '');
      throw projectError(missing ? 'File is unavailable.' : 'Project file storage is temporarily unavailable.', missing ? 404 : 503);
    }
    if (![200, 206].includes(response.status)) {
      await response.body?.cancel();
      throw projectError('Project file storage is temporarily unavailable.', 503);
    }
    res.status(response.status);
    for (const header of ['content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers.get(header);
      if (value) res.set(header, value);
    }
    if (req.method === 'HEAD' || !response.body) {
      await response.body?.cancel();
      res.end();
    } else await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    if (res.headersSent || res.destroyed) throw error;
    res.removeHeader('Content-Disposition');
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    if (error.code === 'ENOENT' || error.status === 404) throw projectError('File is unavailable.', 404);
    throw error;
  } finally { res.off('close', abort); }
}
