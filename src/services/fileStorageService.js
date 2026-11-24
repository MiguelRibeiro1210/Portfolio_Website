import { mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { projectError } from '../domain/projectRules.js';

export function createFileStorage(directory = process.env.PROJECT_UPLOAD_DIR || fileURLToPath(new URL('../uploads/projects/', import.meta.url))) {
  const root = resolve(directory);
  return {
    async stage() {
      await mkdir(root, { recursive: true, mode: 0o700 });
      return mkdtemp(resolve(root, '.upload-'));
    },
    async store(file) {
      const type = await detectFileType(file);
      const id = randomUUID();
      await rename(file.path, resolve(root, id));
      return { id, name: file.originalname.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 255), type, size: file.size };
    },
    path(id) { return resolve(root, id); },
    async remove(ids) { await Promise.all(ids.map(id => rm(resolve(root, id), { force: true }))); },
    async discard(stage) { await rm(stage, { recursive: true, force: true }); },
  };
}

async function detectFileType(file) {
  const handle = await open(file.path, 'r');
  const head = Buffer.alloc(512);
  let tail = Buffer.alloc(0);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(head, 0, head.length, 0));
    if (file.size >= 512) {
      tail = Buffer.alloc(512);
      await handle.read(tail, 0, tail.length, file.size - tail.length);
    }
  } finally { await handle.close(); }
  const bytes = head.subarray(0, bytesRead);
  const starts = hex => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const ascii = (start, end) => bytes.toString('ascii', start, end);
  let mediaType;
  if (starts('89504e470d0a1a0a') && bytes.length >= 24 && ascii(12, 16) === 'IHDR') mediaType = 'image/png';
  else if (starts('ffd8ff')) mediaType = 'image/jpeg';
  else if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) mediaType = 'image/gif';
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') mediaType = 'image/webp';
  else if (ascii(4, 8) === 'ftyp' && /^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(ascii(8, 12))) mediaType = 'video/mp4';
  else if (starts('1a45dfa3') && bytes.includes(Buffer.from('webm'))) mediaType = 'video/webm';
  if (file.fieldname === 'media') {
    if (!mediaType || mediaType !== file.mimetype) throw projectError(`${file.originalname}: unsupported media content.`, 415);
    return mediaType;
  }
  const extension = extname(file.originalname).toLowerCase();
  const zip = starts('504b0304') || starts('504b0506') || starts('504b0708');
  const formats = {
    '.zip': [zip, 'application/zip'], '.apk': [zip, 'application/vnd.android.package-archive'],
    '.exe': [starts('4d5a'), 'application/octet-stream'],
    '.msi': [starts('d0cf11e0a1b11ae1'), 'application/octet-stream'],
    '.appimage': [starts('7f454c46') && ascii(8, 11) === 'AI\x02', 'application/octet-stream'],
    '.deb': [ascii(0, 8) === '!<arch>\n' && bytes.includes(Buffer.from('debian-binary')), 'application/vnd.debian.binary-package'],
    '.dmg': [tail.toString('ascii', 0, 4) === 'koly', 'application/x-apple-diskimage'],
    '.tar': [ascii(257, 262) === 'ustar', 'application/x-tar'],
    '.gz': [starts('1f8b08'), 'application/gzip'],
  };
  if (!formats[extension]?.[0]) throw projectError(`${file.originalname}: unsupported build content.`, 415);
  return formats[extension][1];
}
