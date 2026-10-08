'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const filesRoot = path.resolve(__dirname, '..', 'uploads', 'projects');
const getDownload = db.prepare(`
  SELECT f.id, f.project_id, f.original_name, f.stored_name, f.size_bytes, f.status,
    p.title AS project_title
  FROM project_files f JOIN projects p ON p.id = f.project_id
  WHERE f.id = ?
`);
const recordDownload = db.prepare('INSERT INTO downloads (project_file_id, user_id) VALUES (?, ?)');

router.get('/:fileId', requireAuth, (req, res) => {
  const id = Number(req.params.fileId);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid file ID.' });
  const file = getDownload.get(id);
  if (!file || file.status !== 'active') return res.status(404).json({ error: 'File not found.' });

  if (typeof file.stored_name !== 'string' || !/^[a-f0-9-]{36}\.[a-z0-9]{1,10}$/i.test(file.stored_name)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  const absolute = path.resolve(filesRoot, file.stored_name);
  if (!absolute.startsWith(filesRoot + path.sep)) return res.status(404).json({ error: 'File not found.' });

  let stat;
  try { stat = fs.statSync(absolute); } catch { return res.status(404).json({ error: 'File not found.' }); }
  if (!stat.isFile()) return res.status(404).json({ error: 'File not found.' });

  const stream = fs.createReadStream(absolute);
  let opened = false;
  stream.once('open', () => {
    opened = true;
    try {
      recordDownload.run(file.id, req.user.id);
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.type('application/octet-stream');
      res.attachment(file.original_name || 'download');
      res.set('Content-Length', String(stat.size));
      stream.pipe(res);
    } catch (error) {
      stream.destroy();
      console.error('Could not record download:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'Could not prepare download.' });
      else res.destroy();
    }
  });
  stream.once('error', () => {
    if (!opened && !res.headersSent) return res.status(404).json({ error: 'File not found.' });
    if (opened && !res.destroyed) res.destroy();
  });
});

module.exports = router;
