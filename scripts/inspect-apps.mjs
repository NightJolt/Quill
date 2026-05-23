/**
 * Dump every document in chat_apps with field types — verifies the upsert
 * created a real document with _id matching the env appId.
 */
import mongoose from 'mongoose';
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

await mongoose.connect(env.MONGO_URI);
const docs = await mongoose.connection.db.collection('chat_apps').find({}).toArray();
for (const d of docs) {
  console.log({
    _id: d._id.toString(),
    _idType: d._id._bsontype,
    label: d.label,
    createdAt: d.createdAt?.toISOString?.(),
    encryptedKey: d.encryptedKey
      ? `${d.encryptedKey.slice(0, 24)}... (${d.encryptedKey.length} chars)`
      : null,
    rotatedAt: d.rotatedAt?.toISOString?.() ?? null,
    revoked: d.revoked ?? false,
  });
}
console.log(`\nTotal: ${docs.length}`);
await mongoose.disconnect();
