/**
 * Admin smoke test:
 *   1. Register a fresh "acme-test" app via POST /admin/apps
 *   2. Connect a WS as a user of acme-test (signature minted with the
 *      returned plaintext key)
 *   3. Rotate the key — verify the live socket disconnects and the OLD
 *      signature no longer works
 *   4. Re-connect with a new signature — works
 *   5. Revoke the app — verify the live socket disconnects and the key
 *      can't authenticate any longer
 */
import { io } from 'socket.io-client';
import { createHmac, randomBytes } from 'node:crypto';

const ADMIN = process.env.QUILL_ADMIN_TOKEN;
const BASE = process.env.QUILL_URL || 'http://localhost:8086';
if (!ADMIN) {
  console.error('QUILL_ADMIN_TOKEN required');
  process.exit(1);
}

const sign = (userId, key) => createHmac('sha256', key).update(userId).digest('hex');
const oid = () => randomBytes(12).toString('hex');

let passed = 0;
let failed = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
};

const connect = (auth) =>
  new Promise((resolve, reject) => {
    const sock = io(BASE, { auth, transports: ['websocket'], reconnection: false });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', (err) => reject(err));
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });

const adminPost = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

const adminDelete = (path) =>
  fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN}` },
  }).then((r) => r.json());

async function main() {
  console.log('--- 1. Register acme-test ---');
  const label = `acme-test-${Date.now().toString(36)}`;
  const created = await adminPost('/admin/apps', { label });
  assert(typeof created.appId === 'string', `got appId ${created.appId}`);
  assert(typeof created.privateKey === 'string', `got privateKey`);
  const { appId, privateKey: firstKey } = created;

  console.log('\n--- 2. Connect WS with the new key ---');
  const ALICE = oid();
  const sock1 = await connect({ appId, userId: ALICE, signature: sign(ALICE, firstKey) });
  assert(sock1.connected, 'connected with new app key');

  const disconnected1 = new Promise((res) => sock1.on('disconnect', () => res(true)));

  console.log('\n--- 3. Rotate key — expect old socket disconnect ---');
  const rotated = await adminPost(`/admin/apps/${appId}/rotate`);
  assert(typeof rotated.privateKey === 'string', `got new privateKey`);
  const { privateKey: secondKey } = rotated;
  await Promise.race([
    disconnected1,
    new Promise((_, rej) => setTimeout(() => rej(new Error('socket did not disconnect on rotate')), 2000)),
  ]).then(
    () => assert(true, 'first socket disconnected after rotate'),
    (err) => assert(false, err.message),
  );

  console.log('\n--- 4. Old signature should be rejected ---');
  try {
    await connect({ appId, userId: ALICE, signature: sign(ALICE, firstKey) });
    assert(false, 'old key signature should have been rejected');
  } catch (err) {
    assert(true, `rejected: ${err.message}`);
  }

  console.log('\n--- 5. New signature works ---');
  const sock2 = await connect({ appId, userId: ALICE, signature: sign(ALICE, secondKey) });
  assert(sock2.connected, 'connected with rotated key');
  const disconnected2 = new Promise((res) => sock2.on('disconnect', () => res(true)));

  console.log('\n--- 6. Revoke — expect socket disconnect ---');
  const revoked = await adminDelete(`/admin/apps/${appId}`);
  assert(revoked?.success === true, `revoke ok`);
  await Promise.race([
    disconnected2,
    new Promise((_, rej) => setTimeout(() => rej(new Error('socket did not disconnect on revoke')), 2000)),
  ]).then(
    () => assert(true, 'second socket disconnected after revoke'),
    (err) => assert(false, err.message),
  );

  console.log('\n--- 7. Post-revoke signature is rejected ---');
  try {
    await connect({ appId, userId: ALICE, signature: sign(ALICE, secondKey) });
    assert(false, 'revoked-app signature should have been rejected');
  } catch (err) {
    assert(true, `rejected: ${err.message}`);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
