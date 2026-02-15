// memory.js
const Redis = require("ioredis");

let redis = null;
function getRedis() {
  if (redis) return redis;
  if (!process.env.REDIS_URL) return null;
  redis = new Redis(process.env.REDIS_URL);
  return redis;
}

const memChat = new Map();
const memMeta = new Map();
const memFollow = new Map();
const memUsers = new Set();

function keyChat(user) { return `hongz:chat:${user}`; }
function keyMeta(user) { return `hongz:meta:${user}`; }
function keyFollow(user) { return `hongz:follow:${user}`; }
function keyUsers() { return "hongz:users"; }

async function rememberUser(user) {
  const r = getRedis();
  if (r) return r.sadd(keyUsers(), user);
  memUsers.add(user);
}

async function listUsers() {
  const r = getRedis();
  if (r) return (await r.smembers(keyUsers())) || [];
  return Array.from(memUsers);
}

async function getChat(user) {
  const r = getRedis();
  if (r) {
    const raw = await r.get(keyChat(user));
    return raw ? JSON.parse(raw) : [];
  }
  return memChat.get(user) || [];
}

async function saveChat(user, chat) {
  const r = getRedis();
  if (r) return r.set(keyChat(user), JSON.stringify(chat));
  memChat.set(user, chat);
}

async function addMessage(user, role, text) {
  const chat = await getChat(user);
  chat.push({ role, text, ts: Date.now() });
  const last = chat.slice(-12);
  await saveChat(user, last);
  return last;
}

async function getMeta(user) {
  const r = getRedis();
  if (r) {
    const raw = await r.get(keyMeta(user));
    return raw ? JSON.parse(raw) : {};
  }
  return memMeta.get(user) || {};
}

async function saveMeta(user, meta) {
  const r = getRedis();
  if (r) return r.set(keyMeta(user), JSON.stringify(meta));
  memMeta.set(user, meta);
}

async function getFollowQueue(user) {
  const r = getRedis();
  if (r) {
    const raw = await r.get(keyFollow(user));
    return raw ? JSON.parse(raw) : [];
  }
  return memFollow.get(user) || [];
}

async function saveFollowQueue(user, q) {
  const r = getRedis();
  if (r) return r.set(keyFollow(user), JSON.stringify(q));
  memFollow.set(user, q);
}

async function scheduleFollowUp(user, dueAt, kind) {
  const q = await getFollowQueue(user);
  const exists = q.some(x => x.kind === kind && !x.sent);
  if (exists) return;
  q.push({ dueAt, kind, sent: false });
  await saveFollowQueue(user, q);
}

module.exports = {
  rememberUser,
  listUsers,
  getChat,
  addMessage,
  getMeta,
  saveMeta,
  getFollowQueue,
  saveFollowQueue,
  scheduleFollowUp,
};
