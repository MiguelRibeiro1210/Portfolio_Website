import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import { cvError, cvSizeLimit } from '../domain/cvRules.js';
import { isUUID } from '../domain/projectRules.js';
import { profileResponse, updateProfile } from '../services/cvService.js';
import { createCvStorage } from '../services/cvStorage.js';

export function createCvRouter(getDatabase, { jwtSecret }, storage = createCvStorage()) {
  const router = express.Router();
  const owner = requireAuth(getDatabase, jwtSecret);

  const form = multer({
    limits: { fileSize: cvSizeLimit + 1, files: 1, fields: 11, fieldSize: 40 * 1024, parts: 13 },
  }).single('cv');

  router.use(['/profile/me', '/profiles/:publicId'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.put('/profile/me', owner, (req, res, next) => {

    if (!req.is('multipart/form-data')) return next(cvError('Submit the profile as multipart/form-data.'));
    form(req, res, error => {
      if (!error || error instanceof multer.MulterError) return next(error);
      next(cvError('Invalid multipart form.'));
    });

  }, async (req, res) => {
    if (req.file?.size > cvSizeLimit) throw cvError('PDFs must be 10 MiB or smaller.', 413);
    const profile = await updateProfile(await getDatabase(), storage, req.user.id, req.body, req.file);
    res.json({ profile });
  });



  function unrecognized(res) {
    return res.status(404).json({ message: 'Profile or CV not found.' });
  }

  async function sendPdf(req, res, profile) {

    const file = profile?.attachment;
    if (!file) return unrecognized(res);
    const data = await storage.read(file.key);
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.query.download === '1') res.attachment(file.name);
    else res.set('Content-Disposition', 'inline');
    res.type('application/pdf').send(data);

  }

  router.get('/profiles/:publicId/cv', async (req, res) => {

    if (!isUUID(req.params.publicId)) return unrecognized(res);
    return sendPdf(req, res, await (await getDatabase()).findPublicProfile(req.params.publicId));

  });
  router.get('/profiles/:publicId', async (req, res) => {

    if (!isUUID(req.params.publicId)) return unrecognized(res);
    const profile = await (await getDatabase()).findPublicProfile(req.params.publicId);
    if (!profile) return unrecognized(res);
    res.json({ profile: profileResponse(profile) });

  });

  router.get('/profile/me/cv', owner, async (req, res) => {
    return sendPdf(req, res, await (await getDatabase()).findOwnerProfile(req.user.id));
  });

  router.get('/profile/me', owner, async (req, res) => {
    res.json({ profile: profileResponse(await (await getDatabase()).findOwnerProfile(req.user.id)) });
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof multer.MulterError
      ? (['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code) ? 413 : 400)
      : error.status || 500;
    res.status(status).json({ message: status >= 500 && status !== 503 ? 'Unable to complete the CV request.'
      : error instanceof multer.MulterError ? 'Invalid or oversized profile upload.' : error.message });
  });
  return router;
}
