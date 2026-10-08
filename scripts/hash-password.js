#!/usr/bin/env node
'use strict';

// Run locally with: node scripts/hash-password.js
// The password is read from the terminal without echo and is never saved by this script.
const bcrypt = require('bcrypt');

function readHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(prompt);
    let value = '';
    const wasRaw = Boolean(stdin.isRaw);
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\u0003') {
          stdout.write('\n');
          cleanup();
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          stdout.write('\n');
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    function cleanup() {
      stdin.removeListener('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw);
      stdin.pause();
    }
    stdin.on('data', onData);
  });
}

(async () => {
  const password = await readHidden('Owner password (12+ chars, mixed case and number): ');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 ||
      !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    console.error('Password does not meet the required length/strength rules.');
    process.exitCode = 1;
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  console.log('\nSet OWNER_PASSWORD_HASH in your local .env to this bcrypt hash:');
  console.log(hash);
  console.log('Do not commit .env or share the hash.');
})().catch(() => {
  console.error('Could not generate password hash.');
  process.exitCode = 1;
});
