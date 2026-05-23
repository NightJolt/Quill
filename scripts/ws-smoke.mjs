/**
 * WebSocket smoke test for Quill.
 *
 * Creates a fresh room with alice + bob, connects two clients, alice sends
 * a message, bob should receive it. Also checks bad-signature rejection and
 * non-participant subscribe failure.
 */
import { io } from 'socket.io-client';
import { createHmac, randomBytes } from 'node:crypto';

const KEY = process.env.QUILL_APP_URBANCARE_KEY;
const APP_ID = process.env.QUILL_APP_URBANCARE_ID;
const BASE = process.env.QUILL_URL || 'http://localhost:8086';
if (!KEY || !APP_ID) {
  console.error('QUILL_APP_URBANCARE_ID and QUILL_APP_URBANCARE_KEY env vars required');
  process.exit(1);
}

const sign = (userId) => createHmac('sha256', KEY).update(userId).digest('hex');

// 24-char hex ObjectIds for our three test users.
const oid = () => randomBytes(12).toString('hex');
const ALICE = oid();
const BOB = oid();
const CAROL = oid();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const emitAck = (sock, event, payload) =>
  new Promise((resolve, reject) => {
    sock.timeout(2000).emit(event, payload, (err, ack) => {
      if (err) reject(err);
      else resolve(ack);
    });
  });

async function main() {
  console.log('--- Setup: create room with alice + bob ---');
  const roomRes = await fetch(`${BASE}/internal/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ createdBy: ALICE, name: 'ws smoke', initialParticipants: [ALICE, BOB] }),
  });
  const room = await roomRes.json();
  if (!room.id) {
    console.error('Failed to create room:', room);
    process.exit(1);
  }
  console.log(`  room=${room.id}`);

  console.log('\n--- Test 1: handshake with bad signature is rejected ---');
  try {
    await connect({ appId: APP_ID, userId: ALICE, signature: 'badbadbadbad' });
    assert(false, 'should have been rejected');
  } catch (err) {
    assert(true, `rejected as expected (${err.message})`);
  }

  console.log('\n--- Test 2: handshake with unknown appId (well-formed but unregistered) is rejected ---');
  try {
    const unknownAppId = randomBytes(12).toString('hex');
    await connect({ appId: unknownAppId, userId: ALICE, signature: sign(ALICE) });
    assert(false, 'should have been rejected');
  } catch (err) {
    assert(true, `rejected as expected (${err.message})`);
  }

  console.log('\n--- Test 2a: non-ObjectId appId is rejected ---');
  try {
    await connect({ appId: 'not-an-objectid', userId: ALICE, signature: sign(ALICE) });
    assert(false, 'should have been rejected');
  } catch (err) {
    assert(true, `rejected as expected (${err.message})`);
  }

  console.log('\n--- Test 2b: non-ObjectId userId is rejected ---');
  try {
    await connect({ appId: APP_ID, userId: 'not-an-objectid', signature: sign('not-an-objectid') });
    assert(false, 'should have been rejected');
  } catch (err) {
    assert(true, `rejected as expected (${err.message})`);
  }

  console.log('\n--- Test 3: alice + bob connect with valid signatures ---');
  const alice = await connect({ appId: APP_ID, userId: ALICE, signature: sign(ALICE) });
  assert(alice.connected, 'alice connected');
  const bob = await connect({ appId: APP_ID, userId: BOB, signature: sign(BOB) });
  assert(bob.connected, 'bob connected');

  console.log('\n--- Test 4: subscribe to room they are a participant of ---');
  const aliceSub = await emitAck(alice, 'subscribe', { roomId: room.id });
  assert(aliceSub?.ok === true, `alice subscribe ok (${JSON.stringify(aliceSub)})`);
  const bobSub = await emitAck(bob, 'subscribe', { roomId: room.id });
  assert(bobSub?.ok === true, `bob subscribe ok (${JSON.stringify(bobSub)})`);

  console.log('\n--- Test 5: subscribe to room user is NOT in (carol) ---');
  const carol = await connect({ appId: APP_ID, userId: CAROL, signature: sign(CAROL) });
  const carolSub = await emitAck(carol, 'subscribe', { roomId: room.id });
  assert(carolSub?.ok === false, `carol subscribe rejected (${JSON.stringify(carolSub)})`);
  carol.disconnect();

  console.log('\n--- Test 6: alice sends, bob receives ---');
  const received = new Promise((resolve, reject) => {
    bob.on('message', (evt) => resolve(evt));
    setTimeout(() => reject(new Error('no message received in 3s')), 3000);
  });
  const sendAck = await emitAck(alice, 'send', {
    roomId: room.id,
    content: 'hi from alice',
    clientTempId: 'tmp-1',
  });
  assert(typeof sendAck?.messageId === 'string', `ack has messageId (${JSON.stringify(sendAck)})`);
  const evt = await received;
  assert(evt?.roomId === room.id, `bob received message for room ${room.id}`);
  assert(evt?.message?.content === 'hi from alice', `content matches: "${evt?.message?.content}"`);
  assert(evt?.message?.senderId === ALICE, `senderId=${ALICE}`);
  assert(evt?.clientTempId === 'tmp-1', `clientTempId echoed`);

  console.log('\n--- Test 7: typing event broadcast ---');
  const typingPromise = new Promise((resolve, reject) => {
    bob.on('typing', (evt) => resolve(evt));
    setTimeout(() => reject(new Error('no typing event in 2s')), 2000);
  });
  alice.emit('typing', { roomId: room.id, isTyping: true });
  const typingEvt = await typingPromise;
  assert(typingEvt?.userId === ALICE && typingEvt?.isTyping === true, `typing event ok`);

  console.log('\n--- Test 8: read event ---');
  const readPromise = new Promise((resolve, reject) => {
    alice.on('read', (evt) => resolve(evt));
    setTimeout(() => reject(new Error('no read event in 2s')), 2000);
  });
  bob.emit('read', { roomId: room.id, upTo: new Date().toISOString() });
  const readEvt = await readPromise;
  assert(readEvt?.userId === BOB && typeof readEvt?.lastReadAt === 'string', `read event ok`);

  alice.disconnect();
  bob.disconnect();

  console.log('\n--- Cleanup: soft-delete the test room ---');
  await fetch(`${BASE}/internal/rooms/${room.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${KEY}` },
  });

  await sleep(100);
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
