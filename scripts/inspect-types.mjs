/**
 * Read one document from each chat_* collection and report the BSON type of
 * every id-bearing field. Verifies storage is actually ObjectId (`objectId`)
 * and not string (`string`) after the schema migration.
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
const db = mongoose.connection.db;

const cases = [
  { coll: 'chat_rooms', fields: ['appId'] },
  { coll: 'chat_participants', fields: ['appId', 'roomId', 'userId'] },
  { coll: 'chat_messages', fields: ['appId', 'roomId', 'senderId'] },
];

for (const { coll, fields } of cases) {
  const doc = await db.collection(coll).findOne({});
  console.log(`\n--- ${coll} ---`);
  if (!doc) {
    console.log('  (no documents — skip)');
    continue;
  }
  for (const f of fields) {
    const v = doc[f];
    const t = v?._bsontype ?? typeof v;
    console.log(`  ${f.padEnd(12)} → ${t}${t === 'ObjectId' ? ' ✓' : ' ✗'}`);
  }
}

await mongoose.disconnect();
