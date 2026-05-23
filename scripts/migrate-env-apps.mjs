/**
 * One-shot migration: take any `QUILL_APP_<NAME>_ID` / `_KEY` pairs in .env
 * and write the encrypted key into the existing chat_apps row (creating the
 * row if it's missing). After this runs, the env app vars can be deleted
 * from .env — chat_apps is the source of truth.
 *
 * Uses the same AES-256-GCM envelope as src/auth/key-vault.service.ts.
 *
 *   node scripts/migrate-env-apps.mjs
 */
import mongoose from 'mongoose';
import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const eq = l.indexOf('=');
      return [l.slice(0, eq), l.slice(eq + 1)];
    }),
);

const MONGO_URI = env.MONGO_URI;
const MASTER_KEY = env.QUILL_MASTER_KEY;
if (!MONGO_URI || !MASTER_KEY) {
  console.error('MONGO_URI and QUILL_MASTER_KEY are required in .env');
  process.exit(1);
}
if (!/^[a-fA-F0-9]{64}$/.test(MASTER_KEY)) {
  console.error('QUILL_MASTER_KEY must be 64 hex characters (32 bytes)');
  process.exit(1);
}

const masterKey = Buffer.from(MASTER_KEY, 'hex');

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}

// Find QUILL_APP_<NAME>_ID/_KEY pairs.
const pairs = [];
for (const k of Object.keys(env)) {
  const m = /^QUILL_APP_(.+)_ID$/.exec(k);
  if (!m) continue;
  const name = m[1];
  const appId = env[k];
  const privateKey = env[`QUILL_APP_${name}_KEY`];
  if (!appId || !privateKey) continue;
  pairs.push({ name: name.toLowerCase(), appId, privateKey });
}

if (pairs.length === 0) {
  console.log('No QUILL_APP_*_ID/_KEY pairs in env. Nothing to migrate.');
  process.exit(0);
}

await mongoose.connect(MONGO_URI);
const apps = mongoose.connection.db.collection('chat_apps');

for (const { name, appId, privateKey } of pairs) {
  const _id = new mongoose.Types.ObjectId(appId);
  const encryptedKey = encrypt(privateKey);

  const existing = await apps.findOne({ _id });
  if (!existing) {
    await apps.insertOne({
      _id,
      label: name,
      encryptedKey,
      revoked: false,
      createdAt: new Date(),
    });
    console.log(`  ${name}(${appId}) — inserted new row`);
  } else if (!existing.encryptedKey) {
    await apps.updateOne(
      { _id },
      { $set: { encryptedKey, revoked: existing.revoked ?? false } },
    );
    console.log(`  ${name}(${appId}) — added encryptedKey to existing row`);
  } else {
    console.log(`  ${name}(${appId}) — already has encryptedKey, skipped`);
  }
}

await mongoose.disconnect();
console.log('\nDone. Delete QUILL_APP_* vars from .env when you cut over.');
