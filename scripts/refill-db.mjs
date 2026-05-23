/**
 * Drops Quill's collections so subsequent runs start clean. Use after schema
 * changes that aren't backward-compatible with existing test data.
 *
 *   pnpm dlx node scripts/refill-db.mjs
 */
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';

// Read MONGO_URI from .env without relying on the shell's parser (=&= URLs trip it).
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const eq = l.indexOf('=');
      return [l.slice(0, eq), l.slice(eq + 1)];
    }),
);

const uri = env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI not found in .env');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

const targets = ['chat_rooms', 'chat_participants', 'chat_messages'];
for (const name of targets) {
  try {
    await db.collection(name).drop();
    console.log(`  dropped ${name}`);
  } catch (e) {
    if (e.codeName === 'NamespaceNotFound') {
      console.log(`  ${name} did not exist (skipped)`);
    } else {
      throw e;
    }
  }
}

await mongoose.disconnect();
console.log('Done.');
