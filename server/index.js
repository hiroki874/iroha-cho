import express from 'express';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(express.json({ limit: '1mb' }));
const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, 'push-data.json');
const readDb = () => { try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { return { subscriptions: {}, jobs: [] }; } };
const writeDb = db => fs.writeFileSync(dbFile, JSON.stringify(db));
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
if (publicKey && privateKey) webpush.setVapidDetails(subject, publicKey, privateKey);
app.get('/api/health', (_req, res) => res.json({ ok: true, pushConfigured: !!(publicKey && privateKey) }));
app.get('/api/public-key', (_req, res) => publicKey ? res.json({ publicKey }) : res.status(503).json({ error: 'Push not configured' }));
app.post('/api/subscribe', (req, res) => {
  const { clientId, subscription } = req.body || {};
  if (!clientId || !subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const db = readDb(); db.subscriptions[clientId] = subscription; writeDb(db); res.json({ ok: true });
});
app.post('/api/schedule', (req, res) => {
  const { clientId, jobs } = req.body || {};
  if (!clientId || !Array.isArray(jobs)) return res.status(400).json({ error: 'Invalid schedule' });
  const db = readDb();
  db.jobs = db.jobs.filter(job => job.clientId !== clientId);
  for (const job of jobs) {
    const at = Date.parse(job.at);
    if (job.id && Number.isFinite(at) && at > Date.now() && job.encrypted?.iv && job.encrypted?.cipher) db.jobs.push({ clientId, id: job.id, at, encrypted: job.encrypted });
  }
  writeDb(db); res.json({ ok: true, count: jobs.length });
});
app.post('/api/unsubscribe', (req, res) => {
  const { clientId } = req.body || {}; const db = readDb();
  delete db.subscriptions[clientId]; db.jobs = db.jobs.filter(job => job.clientId !== clientId); writeDb(db); res.json({ ok: true });
});
setInterval(async () => {
  if (!publicKey || !privateKey) return;
  const db = readDb(); const now = Date.now(); const due = db.jobs.filter(job => job.at <= now);
  if (!due.length) return;
  db.jobs = db.jobs.filter(job => job.at > now); writeDb(db);
  for (const job of due) {
    const subscription = db.subscriptions[job.clientId]; if (!subscription) continue;
    try { await webpush.sendNotification(subscription, JSON.stringify(job.encrypted), { TTL: 60 * 60 }); }
    catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) { const fresh = readDb(); delete fresh.subscriptions[job.clientId]; fresh.jobs = fresh.jobs.filter(x => x.clientId !== job.clientId); writeDb(fresh); }
    }
  }
}, 5000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Iroha server listening on ${port}`));
