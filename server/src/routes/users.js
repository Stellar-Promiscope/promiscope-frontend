const express = require('express');
const crypto = require('crypto');
const userDataService = require('../userDataService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Service-credential auth (issue #1352). Until the backend has its own user
 * auth, only the Next server may call these routes: it sends
 * `Authorization: Bearer $BACKEND_SERVICE_TOKEN` plus the wallet it has
 * already verified from the session cookie in `X-Wallet`.
 */
function requireService(req, res, next) {
  const expected = process.env.BACKEND_SERVICE_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Service auth is not configured' });
  }
  const given = (req.get('authorization') ?? '').replace(/^Bearer /, '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const wallet = req.get('x-wallet');
  if (!wallet) {
    return res.status(400).json({ error: 'X-Wallet header is required' });
  }
  req.wallet = wallet;
  next();
}

router.use(requireService);

// GET /users/me/export
router.get('/me/export', (req, res) => {
  res.json(userDataService.exportWalletData(req.wallet));
});

// DELETE /users/me
router.delete('/me', (req, res) => {
  const result = userDataService.deleteWalletData(req.wallet);
  req.log?.info('Deleted backend user data', result);
  res.json(result);
});

// GET /users/me/sponsorship-waitlist?email=... — caller has verified the email.
router.get('/me/sponsorship-waitlist', (req, res) => {
  const email = req.query.email;
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  res.json({ entry: userDataService.exportWaitlistEmail(email) });
});

// DELETE /users/me/sponsorship-waitlist — body { email }; caller has verified the email.
router.delete('/me/sponsorship-waitlist', (req, res) => {
  const email = req.body?.email;
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  res.json({ removed: userDataService.deleteWaitlistEmail(email) });
});

module.exports = router;
