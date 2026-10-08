require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

// Prepare local runtime directories. Database initialization and application
// routes will be added in the next implementation phase.
for (const directory of [
  path.resolve('./database'),
  path.resolve('./uploads/projects'),
  path.resolve('./uploads/images'),
]) {
  fs.mkdirSync(directory, { recursive: true });
}

app.disable('x-powered-by');
app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use(express.json({ limit: '30kb' }));
app.use(express.static(path.resolve('./public')));

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', app: 'C8B' });
});

app.get('/', (_req, res) => {
  res.sendFile(path.resolve('./index.html'));
});

app.use((req, res) => {
  res.status(404).send('404 — Page not found');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`C8B server listening on port ${port}`);
});
