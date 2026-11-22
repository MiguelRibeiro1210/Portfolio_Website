import express from 'express';
import { registerUser } from '../services/authService.js';

export function createAuthRouter(getDatabase) {
  const router = express.Router();

  router.post('/register', express.json(), async (req, res) => {

    const result = await registerUser(req.body, getDatabase);

    if (result.error) return res.status(400).json({ message: result.error });

    if (result.duplicate) return res.status(409).json({ message: 'An account already exists for that email.' });

    res.status(201).json({ user: result.user });

  });

  router.use((error, req, res, next) => {

    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'Invalid JSON request body.' });
    }

    if (error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ message: 'Unable to read the request body.' });
    }

    res.status(500).json({ message: 'Unable to register the account.' });
  });

  return router;
}
