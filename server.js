const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

const app = express();
app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Telegram-Init-Data"] }));
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 10000;
const DB_URL = process.env.TURSO_DATABASE_URL;
const DB_TOKEN = process.env.TURSO_AUTH_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "SNPCOINBot";
const TREASURY_WALLET = process.env.TREASURY_WALLET || "UQDMsJu14wu-EHSjaRpufQdPb73pKVRkQvHNezgA2zF69sJX";
const SNP_CONTRACT = process.env.SNP_CONTRACT || "EQAmLlerUViNn9PwFVRlR_AjDvhd5pkmeLNOu5bNDpvXV0ls";
const TONCENTER = process.env.TONCENTER_API || "https://toncenter.com/api/v3";
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || "";
const FEE_NANO = "100000000";
const ENERGY_REGEN_SECONDS = 3;
const REFERRAL_RATE = 0.15;
const REFERRAL_JOIN_REWARD = 100;
const HOLDER_MIN_SNP = 50000;

if (!DB_URL || !DB_TOKEN || !BOT_TOKEN) {
  console.error("Missing TURSO_DATABASE_URL, TURSO_AUTH_TOKEN or TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const db = createClient({ url: DB_URL, authToken: DB_TOKEN });

// ============================================================
// BOOSTS: one visible next upgrade per category
// ============================================================
const BOOST_LEVELS = {
  tap: [
    { level: 2, price: 200, name: "Tap ×2", description: "2 SNP per tap" },
    { level: 3, price: 300, name: "Tap ×3", description: "3 SNP per tap" },
    { level: 4, price: 500, name: "Tap ×4", description: "4 SNP per tap" },
    { level: 5, price: 800, name: "Tap ×5", description: "5 SNP per tap" }
  ],
  energy: [
    { level: 2, price: 200, name: "Energy ×2", description: "Maximum 2,000 energy" },
    { level: 3, price: 350, name: "Energy ×3", description: "Maximum 3,000 energy" },
    { level: 4, price: 600, name: "Energy ×4", description: "Maximum 4,000 energy" },
    { level: 5, price: 1000, name: "Energy ×5", description: "Maximum 5,000 energy" }
  ],
  recharge: [
    { level: 2, price: 150, name: "Recharge ×2", description: "Energy regenerates 2× faster" },
    { level: 3, price: 300, name: "Recharge ×3", description: "Energy regenerates 3× faster" },
    { level: 4, price: 450, name: "Recharge ×4", description: "Energy regenerates 4× faster" },
    { level: 5, price: 650, name: "Recharge ×5", description: "Energy regenerates 5× faster" }
  ]
};

const TASKS = [
  { id: "channel", name: "Join SINAPS Channel", reward: 100, icon: "📢", url: "https://t.me/SINAPS_COIN", chat: "@SINAPS_COIN", type: "telegram" },
  { id: "group", name: "Join SINAPS Group", reward: 70, icon: "👥", url: "https://t.me/SINAPS_Group", chat: "@SINAPS_Group", type: "telegram" },
  { id: "holder", name: "Hold 50,000 SNP", reward: 1000, icon: "💎", url: "#", type: "holder" }
];

function now() { return new Date().toISOString(); }
function dateOnly() { return new Date().toISOString().slice(0, 10); }
function randomCode() { return crypto.randomBytes(5).toString("hex").toUpperCase(); }
function parseTime(value) {
  if (!value) return Date.now();
  const s = String(value);
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z";
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? t : Date.now();
}
function dayDifference(a, b) {
  const aa = new Date(`${a}T00:00:00Z`).getTime();
  const bb = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((bb - aa) / 86400000);
}
function safeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

// ============================================================
// TELEGRAM AUTH
// ============================================================
function verifyTelegram(initData) {
  try {
    if (!initData || !BOT_TOKEN) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const expected = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Math.abs(Math.floor(Date.now() / 1000) - authDate) > 86400) return null;
    const user = JSON.parse(params.get("user") || "{}");
    if (!user.id) return null;
    return { id: String(user.id), username: user.username || "" };
  } catch (e) {
    console.error("Telegram auth:", e.message);
    return null;
  }
}
function auth(req) { return verifyTelegram(req.headers["x-telegram-init-data"]); }
function requireAuth(req, res) {
  const user = auth(req);
  if (!user?.id) { res.status(401).json({ error: "Telegram authentication required" }); return null; }
  return user;
}

// ============================================================
// DB HELPERS
// ============================================================
async function getUser(telegramId) {
  const r = await db.execute({ sql: `SELECT * FROM users WHERE telegram_id = ? LIMIT 1`, args: [String(telegramId)] });
  return r.rows[0] || null;
}
function publicUser(user) {
  if (!user) return null;
  return {
    telegram_id: String(user.telegram_id), username: user.username || "",
    balance: Number(user.balance || 0), energy: Number(user.energy || 0), max_energy: Number(user.max_energy || 1000),
    tap_power: Number(user.tap_power || 1), tap_boost_level: Number(user.tap_boost_level || 1),
    energy_boost_level: Number(user.energy_boost_level || 1), recharge_multiplier: Number(user.recharge_multiplier || 1),
    recharge_level: Number(user.recharge_level || 1), wallet_address: user.wallet_address || null, referral_code: user.referral_code || "",
    referral_rewarded: Number(user.referral_rewarded || 0)
  };
}
async function addTransaction(telegramId, type, amount, status, details) {
  await db.execute({ sql: `INSERT INTO transactions (telegram_id,type,amount,status,details,created_at) VALUES (?,?,?,?,?,?)`, args: [String(telegramId), type, Number(amount), status, details || "", now()] });
}
async function syncEnergy(telegramId) {
  const user = await getUser(telegramId);
  if (!user) return null;
  const maxEnergy = Math.max(1, Number(user.max_energy || 1000));
  const energy = Math.max(0, Number(user.energy || 0));
  const multiplier = Math.max(1, Number(user.recharge_multiplier || 1));
  const last = parseTime(user.last_energy_update);
  const interval = (ENERGY_REGEN_SECONDS * 1000) / multiplier;
  const gained = Math.floor(Math.max(0, Date.now() - last) / interval);
  if (gained <= 0) return user;
  const newEnergy = Math.min(maxEnergy, energy + gained);
  const newTime = newEnergy >= maxEnergy ? now() : new Date(last + gained * interval).toISOString();
  await db.execute({ sql: `UPDATE users SET energy=?, last_energy_update=? WHERE telegram_id=?`, args: [newEnergy, newTime, String(telegramId)] });
  return getUser(telegramId);
}
async function rewardReferralOwner(telegramId, rewardAmount, source) {
  const user = await getUser(telegramId);
  // A referral only becomes active after the invited user connects a TON wallet.
  if (!user?.referred_by || !user?.wallet_address || Number(rewardAmount) <= 0) return 0;
  const bonus = Math.floor(Number(rewardAmount) * REFERRAL_RATE);
  if (bonus <= 0) return 0;
  const r = await db.execute({ sql: `UPDATE users SET balance=balance+? WHERE telegram_id=?`, args: [bonus, String(user.referred_by)] });
  if (r.rowsAffected) await addTransaction(user.referred_by, "REFERRAL", bonus, "Completed", `${source} referral bonus`);
  return bonus;
}

async function qualifyReferral(telegramId) {
  const user = await getUser(telegramId);
  if (!user?.referred_by || !user?.wallet_address || Number(user.referral_rewarded || 0) === 1) return 0;
  const changed = await db.execute({
    sql: `UPDATE users SET referral_rewarded=1 WHERE telegram_id=? AND referred_by IS NOT NULL AND wallet_address IS NOT NULL AND referral_rewarded=0`,
    args: [String(telegramId)]
  });
  if (!changed.rowsAffected) return 0;
  const referrer = await getUser(user.referred_by);
  if (!referrer) return 0;
  await db.execute({ sql: `UPDATE users SET balance=balance+? WHERE telegram_id=?`, args: [REFERRAL_JOIN_REWARD, String(user.referred_by)] });
  await addTransaction(user.referred_by, "REFERRAL", REFERRAL_JOIN_REWARD, "Completed", `Wallet-connected referral: ${telegramId}`);
  return REFERRAL_JOIN_REWARD;
}
async function rewardUser(telegramId, amount, type, details) {
  await db.execute({ sql: `UPDATE users SET balance=balance+? WHERE telegram_id=?`, args: [Number(amount), String(telegramId)] });
  await addTransaction(telegramId, type, amount, "Completed", details);
  await rewardReferralOwner(telegramId, amount, type);
}

// ============================================================
// DATABASE
// ============================================================
async function ensureColumn(table, column, definition) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  if (!r.rows.some(x => String(x.name) === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
async function initDB() {
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT UNIQUE NOT NULL, username TEXT, balance INTEGER DEFAULT 0,
    energy INTEGER DEFAULT 1000, max_energy INTEGER DEFAULT 1000, last_energy_update TEXT, created_at TEXT,
    last_daily_bonus TEXT, daily_streak INTEGER DEFAULT 0, referral_code TEXT UNIQUE, referred_by TEXT, wallet_address TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, type TEXT, amount INTEGER, status TEXT, details TEXT, created_at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS task_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, task_id TEXT NOT NULL, reward INTEGER NOT NULL, status TEXT, created_at TEXT,
    UNIQUE(telegram_id,task_id)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS daily_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, day INTEGER NOT NULL, reward INTEGER NOT NULL, claimed_at TEXT,
    UNIQUE(telegram_id,day,claimed_at)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS boost_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, boost_id TEXT NOT NULL, boost_type TEXT NOT NULL, level INTEGER NOT NULL, price INTEGER NOT NULL, created_at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, withdrawal_id TEXT UNIQUE, telegram_id TEXT, wallet_address TEXT, amount INTEGER, fee_ton TEXT, fee_nano TEXT,
    treasury_wallet TEXT, token_contract TEXT, status TEXT DEFAULT 'payment_pending', fee_tx_hash TEXT, payout_tx_hash TEXT, created_at TEXT, verified_at TEXT, completed_at TEXT
  )`);
  await ensureColumn("users", "tap_power", "INTEGER DEFAULT 1");
  await ensureColumn("users", "tap_boost_level", "INTEGER DEFAULT 1");
  await ensureColumn("users", "energy_boost_level", "INTEGER DEFAULT 1");
  await ensureColumn("users", "recharge_multiplier", "INTEGER DEFAULT 1");
  await ensureColumn("users", "recharge_level", "INTEGER DEFAULT 1");
  await ensureColumn("users", "referral_rewarded", "INTEGER DEFAULT 0");
  // Existing users created by older versions may already have received the 100 SNP join reward.
  await db.execute(`UPDATE users SET referral_rewarded=1 WHERE referred_by IS NOT NULL AND EXISTS (SELECT 1 FROM transactions t WHERE t.telegram_id=users.referred_by AND t.type='REFERRAL' AND t.details LIKE '%New SINAPS referral%')`);
  console.log("Database ready");
}

// ============================================================
// TELEGRAM / TON HELPERS
// ============================================================
async function telegramApi(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}
async function isTelegramMember(chat, telegramId) {
  const member = await telegramApi("getChatMember", { chat_id: chat, user_id: telegramId });
  return ["creator", "administrator", "member"].includes(member.status) || (member.status === "restricted" && member.is_member === true);
}
async function checkSnpBalance(wallet) {
  if (!wallet) return false;
  const headers = TONCENTER_API_KEY ? { "X-API-Key": TONCENTER_API_KEY } : {};
  const url = `${TONCENTER}/jetton/wallets?address=${encodeURIComponent(wallet)}&jetton_address=${encodeURIComponent(SNP_CONTRACT)}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error("Unable to verify SNP balance");
  const data = await r.json();
  const row = data.jetton_wallets?.[0] || data.wallets?.[0] || data[0];
  const raw = BigInt(String(row?.balance || "0"));
  return raw >= BigInt(HOLDER_MIN_SNP) * 1000000000n;
}

// ============================================================
// ROOT
// ============================================================
app.get("/", (req, res) => res.json({ project: "SINAPS", status: "online", version: "4.1.0" }));

// ============================================================
// USER / REFERRAL
// ============================================================
app.post("/api/user", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const telegramId = verified.id;
    const username = verified.username || "";
    const startParam = String(req.body.start_param || "").trim().toUpperCase();
    let user = await getUser(telegramId);
    if (!user) {
      let referralCode = randomCode();
      while ((await db.execute({ sql: `SELECT telegram_id FROM users WHERE referral_code=?`, args: [referralCode] })).rows.length) referralCode = randomCode();
      let referredBy = null;
      if (startParam) {
        const ref = await db.execute({ sql: `SELECT telegram_id FROM users WHERE referral_code=? LIMIT 1`, args: [startParam] });
        if (ref.rows.length && String(ref.rows[0].telegram_id) !== telegramId) referredBy = String(ref.rows[0].telegram_id);
      }
      await db.execute({ sql: `INSERT INTO users (telegram_id,username,balance,energy,max_energy,last_energy_update,created_at,last_daily_bonus,daily_streak,referral_code,referred_by,tap_power,tap_boost_level,energy_boost_level,recharge_multiplier,recharge_level) VALUES (?,?,0,1000,1000,?,?,NULL,0,?,?,1,1,1,1,1)`, args: [telegramId, username, now(), now(), referralCode, referredBy] });
      user = await getUser(telegramId);
    } else {
      await db.execute({ sql: `UPDATE users SET username=? WHERE telegram_id=?`, args: [username, telegramId] });
    }
    user = await syncEnergy(telegramId);
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) { console.error("/api/user", e); res.status(500).json({ error: "User load failed" }); }
});

// ============================================================
// TAP
// ============================================================
app.post("/api/tap", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const telegramId = verified.id;
    const user = await syncEnergy(telegramId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const count = Math.min(50, Math.max(1, safeInt(req.body.count, 1)));
    const energy = Number(user.energy || 0);
    const tapPower = Number(user.tap_power || 1);
    const usable = Math.min(count, energy);
    if (usable <= 0) return res.status(400).json({ error: "No energy", user: publicUser(user) });
    const reward = usable * tapPower;
    const result = await db.execute({ sql: `UPDATE users SET balance=balance+?, energy=energy-?, last_energy_update=? WHERE telegram_id=? AND energy>=?`, args: [reward, usable, now(), telegramId, usable] });
    if (!result.rowsAffected) return res.status(409).json({ error: "Tap conflict. Try again." });
    const updated = await getUser(telegramId);
    res.json({ ok: true, taps: usable, reward, user: publicUser(updated) });
  } catch (e) { console.error("/api/tap", e); res.status(500).json({ error: "Tap failed" }); }
});

// ============================================================
// BOOSTS
// ============================================================
function getBoostLevel(user, type) {
  if (type === "tap") return Number(user.tap_boost_level || 1);
  if (type === "energy") return Number(user.energy_boost_level || 1);
  return Number(user.recharge_level || 1);
}
app.get("/api/boosts", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const user = await syncEnergy(verified.id);
    const boosts = Object.entries(BOOST_LEVELS).map(([type, levels]) => {
      const current = getBoostLevel(user, type);
      const next = levels.find(x => x.level === current + 1);
      return { type, current_level: current, max_level: levels.at(-1).level, next: next ? { ...next, icon: type === "tap" ? "⚡" : type === "energy" ? "🔋" : "🚀" } : null };
    });
    res.json({ ok: true, balance: Number(user.balance || 0), boosts });
  } catch (e) { console.error("/api/boosts", e); res.status(500).json({ error: "Failed to load boosts" }); }
});
app.post("/api/boosts/buy", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const telegramId = verified.id;
    const user = await syncEnergy(telegramId);
    const type = String(req.body.type || "");
    if (!BOOST_LEVELS[type]) return res.status(400).json({ error: "Invalid boost type" });
    const current = getBoostLevel(user, type);
    const next = BOOST_LEVELS[type].find(x => x.level === current + 1);
    if (!next) return res.status(400).json({ error: "Maximum level reached" });
    const deducted = await db.execute({ sql: `UPDATE users SET balance=balance-? WHERE telegram_id=? AND balance>=?`, args: [next.price, telegramId, next.price] });
    if (!deducted.rowsAffected) return res.status(400).json({ error: `Not enough SNP. Need ${next.price} SNP.` });
    if (type === "tap") await db.execute({ sql: `UPDATE users SET tap_power=?,tap_boost_level=? WHERE telegram_id=?`, args: [next.level, next.level, telegramId] });
    if (type === "energy") {
      const newMax = next.level * 1000;
      const oldMax = Number(user.max_energy || 1000);
      const oldEnergy = Number(user.energy || 0);
      const newEnergy = Math.min(newMax, oldEnergy + Math.max(0, newMax - oldMax));
      await db.execute({ sql: `UPDATE users SET max_energy=?,energy=?,energy_boost_level=? WHERE telegram_id=?`, args: [newMax, newEnergy, next.level, telegramId] });
    }
    if (type === "recharge") await db.execute({ sql: `UPDATE users SET recharge_multiplier=?,recharge_level=? WHERE telegram_id=?`, args: [next.level, next.level, telegramId] });
    await db.execute({ sql: `INSERT INTO boost_purchases (telegram_id,boost_id,boost_type,level,price,created_at) VALUES (?,?,?,?,?,?)`, args: [telegramId, `${type}${next.level}`, type, next.level, next.price, now()] });
    await addTransaction(telegramId, "BOOST", -next.price, "Completed", `Purchased ${next.name}`);
    const updated = await getUser(telegramId);
    res.json({ ok: true, message: `${next.name} activated`, user: publicUser(updated) });
  } catch (e) { console.error("/api/boosts/buy", e); res.status(500).json({ error: "Boost purchase failed" }); }
});

// ============================================================
// DAILY
// ============================================================
app.get("/api/daily/status", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const user = await getUser(verified.id);
    const today = dateOnly();
    const last = user?.last_daily_bonus ? String(user.last_daily_bonus).slice(0, 10) : null;
    const claimedToday = last === today;
    let nextDay = 1;
    if (claimedToday) nextDay = Number(user.daily_streak || 1);
    else if (last && dayDifference(last, today) === 1) nextDay = Number(user.daily_streak || 0) + 1;
    if (nextDay > 30) nextDay = 1;
    const streak = Number(user.daily_streak || 0);
    const claimedThrough = claimedToday ? Math.min(30, streak) : (last && dayDifference(last, today) === 1 ? Math.max(0, nextDay - 1) : 0);
    const claimedDays = Array.from({ length: claimedThrough }, (_, i) => i + 1);
    res.json({ ok: true, claimedToday, currentDay: streak, nextDay, reward: nextDay * 10, claimedDays });
  } catch (e) { console.error("/api/daily/status", e); res.status(500).json({ error: "Daily status failed" }); }
});
app.post("/api/daily/claim", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const telegramId = verified.id;
    const user = await getUser(telegramId);
    const today = dateOnly();
    const last = user?.last_daily_bonus ? String(user.last_daily_bonus).slice(0, 10) : null;
    if (last === today) return res.status(400).json({ error: "Daily reward already claimed" });
    let day = (last && dayDifference(last, today) === 1) ? Number(user.daily_streak || 0) + 1 : 1;
    if (day > 30) day = 1;
    const reward = day * 10;
    const updated = await db.execute({ sql: `UPDATE users SET balance=balance+?,daily_streak=?,last_daily_bonus=? WHERE telegram_id=? AND (last_daily_bonus IS NULL OR substr(last_daily_bonus,1,10)<>?)`, args: [reward, day, today, telegramId, today] });
    if (!updated.rowsAffected) return res.status(409).json({ error: "Daily reward already claimed" });
    await db.execute({ sql: `INSERT INTO daily_rewards (telegram_id,day,reward,claimed_at) VALUES (?,?,?,?)`, args: [telegramId, day, reward, now()] });
    await addTransaction(telegramId, "DAILY", reward, "Completed", `Day ${day}`);
    await rewardReferralOwner(telegramId, reward, "DAILY");
    const fresh = await getUser(telegramId);
    res.json({ ok: true, day, reward, balance: Number(fresh.balance || 0) });
  } catch (e) { console.error("/api/daily/claim", e); res.status(500).json({ error: "Daily claim failed" }); }
});

// ============================================================
// WALLET
// ============================================================
app.post("/api/wallet/connect", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const wallet = String(req.body.wallet_address || "").trim();
    if (wallet.length < 20 || wallet.length > 150) return res.status(400).json({ error: "Invalid TON wallet" });
    await db.execute({ sql: `UPDATE users SET wallet_address=? WHERE telegram_id=?`, args: [wallet, verified.id] });
    const referralReward = await qualifyReferral(verified.id);
    const user = await getUser(verified.id);
    res.json({ ok: true, wallet_address: wallet, referral_reward: referralReward, user: publicUser(user) });
  } catch (e) { console.error("/api/wallet/connect", e); res.status(500).json({ error: "Wallet save failed" }); }
});
app.post("/api/wallet/disconnect", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    await db.execute({ sql: `UPDATE users SET wallet_address=NULL WHERE telegram_id=?`, args: [verified.id] });
    res.json({ ok: true, wallet_address: null });
  } catch (e) { console.error("/api/wallet/disconnect", e); res.status(500).json({ error: "Wallet disconnect failed" }); }
});
app.post("/api/wallet/get", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const user = await getUser(verified.id);
    res.json({ ok: true, wallet_address: user?.wallet_address || null });
  } catch (e) { res.status(500).json({ error: "Wallet lookup failed" }); }
});

// ============================================================
// TASKS
// ============================================================
app.get("/api/tasks", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const r = await db.execute({ sql: `SELECT task_id FROM task_claims WHERE telegram_id=?`, args: [verified.id] });
    const claimed = new Set(r.rows.map(x => String(x.task_id)));
    res.json({ ok: true, tasks: TASKS.map(t => ({ ...t, completed: claimed.has(t.id), action: t.type === "holder" ? "VERIFY" : "JOIN & VERIFY" })) });
  } catch (e) { console.error("/api/tasks", e); res.status(500).json({ error: "Tasks failed" }); }
});
app.post("/api/tasks/claim", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const telegramId = verified.id;
    const taskId = String(req.body.task_id || "");
    const task = TASKS.find(t => t.id === taskId);
    if (!task) return res.status(400).json({ error: "Task not found" });
    const existing = await db.execute({ sql: `SELECT id FROM task_claims WHERE telegram_id=? AND task_id=?`, args: [telegramId, taskId] });
    if (existing.rows.length) return res.status(400).json({ error: "Task already completed" });
    if (task.type === "telegram") {
      try {
        if (!(await isTelegramMember(task.chat, telegramId))) return res.status(400).json({ error: "Join the channel/group first, then verify." });
      } catch (e) {
        console.error("membership check", e);
        return res.status(400).json({ error: "Telegram could not verify membership. Make the bot an admin in the channel/group." });
      }
    }
    if (task.type === "holder") {
      const user = await getUser(telegramId);
      const wallet = String(req.body.wallet_address || user?.wallet_address || "").trim();
      if (!wallet) return res.status(400).json({ error: "Connect your TON wallet first." });
      if (!(await checkSnpBalance(wallet))) return res.status(400).json({ error: `You need at least ${HOLDER_MIN_SNP.toLocaleString("en-US")} SNP in this wallet.` });
    }
    await db.execute({ sql: `INSERT INTO task_claims (telegram_id,task_id,reward,status,created_at) VALUES (?,?,?,?,?)`, args: [telegramId, task.id, task.reward, "Completed", now()] });
    await rewardUser(telegramId, task.reward, "TASK", task.name);
    const user = await getUser(telegramId);
    res.json({ ok: true, reward: task.reward, balance: Number(user.balance || 0) });
  } catch (e) { console.error("/api/tasks/claim", e); res.status(500).json({ error: "Task verification failed" }); }
});

// ============================================================
// FRIENDS / REFERRAL
// ============================================================
app.get("/api/friends", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const user = await getUser(verified.id);
    const friends = await db.execute({
      sql: `SELECT telegram_id,username,created_at,balance,wallet_address,referral_rewarded FROM users WHERE referred_by=? ORDER BY created_at DESC`,
      args: [verified.id]
    });
    const earnings = await db.execute({ sql: `SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE telegram_id=? AND type='REFERRAL' AND amount>0`, args: [verified.id] });
    const code = user?.referral_code || "";
    const mapped = friends.rows.map(f => ({
      telegram_id: String(f.telegram_id),
      username: f.username || "",
      created_at: f.created_at,
      balance: Number(f.balance || 0),
      wallet_connected: Boolean(f.wallet_address),
      referral_rewarded: Number(f.referral_rewarded || 0) === 1,
      status: f.wallet_address ? "ACTIVE" : "CONNECT WALLET"
    }));
    res.json({
      ok: true, referral_code: code,
      referral_link: `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(code)}`,
      total_friends: mapped.length,
      active_referrals: mapped.filter(f => f.wallet_connected).length,
      total_earnings: Number(earnings.rows[0]?.total || 0),
      invite_reward: REFERRAL_JOIN_REWARD,
      referral_rate: REFERRAL_RATE,
      friends: mapped
    });
  } catch (e) { console.error("/api/friends", e); res.status(500).json({ error: "Friends failed" }); }
});

// ============================================================
// HISTORY
// ============================================================
app.get("/api/history", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const r = await db.execute({ sql: `SELECT * FROM transactions WHERE telegram_id=? ORDER BY id DESC LIMIT 100`, args: [verified.id] });
    res.json({ ok: true, history: r.rows });
  } catch (e) { res.status(500).json({ error: "History failed" }); }
});

// ============================================================
// WITHDRAWAL
// NOTE: this version reserves SNP and collects the 0.1 TON fee.
// Actual SNP payout still requires a backend treasury signer.
// ============================================================
app.post("/api/withdraw/create", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const telegramId = verified.id;
    const amount = safeInt(req.body.amount, 0);
    const requestedWallet = String(req.body.wallet_address || "").trim();
    if (amount <= 0) return res.status(400).json({ error: "Invalid withdrawal amount" });
    const user = await getUser(telegramId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!requestedWallet || requestedWallet.length < 20) return res.status(400).json({ error: "Connect your wallet first" });
    if (user.wallet_address && user.wallet_address !== requestedWallet) return res.status(400).json({ error: "Wallet does not match your connected wallet" });
    const withdrawalId = `SNP-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const deducted = await db.execute({ sql: `UPDATE users SET balance=balance-? WHERE telegram_id=? AND balance>=?`, args: [amount, telegramId, amount] });
    if (!deducted.rowsAffected) return res.status(400).json({ error: "Not enough SNP" });
    try {
      await db.execute({ sql: `INSERT INTO withdrawals (withdrawal_id,telegram_id,wallet_address,amount,fee_ton,fee_nano,treasury_wallet,token_contract,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [withdrawalId, telegramId, requestedWallet, amount, "0.1", FEE_NANO, TREASURY_WALLET, SNP_CONTRACT, "payment_pending", now()] });
      await addTransaction(telegramId, "WITHDRAW", -amount, "Reserved", `Withdrawal ${withdrawalId}`);
    } catch (e) {
      await db.execute({ sql: `UPDATE users SET balance=balance+? WHERE telegram_id=?`, args: [amount, telegramId] });
      throw e;
    }
    const fresh = await getUser(telegramId);
    res.json({ ok: true, withdrawal_id: withdrawalId, fee_nano: FEE_NANO, treasury_wallet: TREASURY_WALLET, status: "payment_pending", balance: Number(fresh.balance || 0) });
  } catch (e) { console.error("/api/withdraw/create", e); res.status(500).json({ error: "Withdrawal creation failed" }); }
});
app.post("/api/withdraw/verify", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const id = String(req.body.withdrawal_id || "");
    const r = await db.execute({ sql: `SELECT * FROM withdrawals WHERE withdrawal_id=? AND telegram_id=? LIMIT 1`, args: [id, verified.id] });
    if (!r.rows.length) return res.status(404).json({ error: "Withdrawal not found" });
    const w = r.rows[0];
    if (w.status === "payment_pending") {
      await db.execute({ sql: `UPDATE withdrawals SET status='fee_submitted',verified_at=? WHERE withdrawal_id=? AND telegram_id=? AND status='payment_pending'`, args: [now(), id, verified.id] });
    }
    const fresh = await db.execute({ sql: `SELECT * FROM withdrawals WHERE withdrawal_id=? AND telegram_id=?`, args: [id, verified.id] });
    res.json({ ok: true, withdrawal: fresh.rows[0] });
  } catch (e) { console.error("/api/withdraw/verify", e); res.status(500).json({ error: "Withdrawal verification failed" }); }
});
app.post("/api/withdraw/cancel", async (req, res) => {
  try {
    const verified = requireAuth(req, res); if (!verified) return;
    const id = String(req.body.withdrawal_id || "");
    const r = await db.execute({ sql: `SELECT * FROM withdrawals WHERE withdrawal_id=? AND telegram_id=? LIMIT 1`, args: [id, verified.id] });
    if (!r.rows.length) return res.status(404).json({ error: "Withdrawal not found" });
    const w = r.rows[0];
    if (!["payment_pending"].includes(String(w.status))) return res.status(400).json({ error: "This withdrawal can no longer be cancelled" });
    const changed = await db.execute({ sql: `UPDATE withdrawals SET status='cancelled' WHERE withdrawal_id=? AND telegram_id=? AND status='payment_pending'`, args: [id, verified.id] });
    if (changed.rowsAffected) {
      await db.execute({ sql: `UPDATE users SET balance=balance+? WHERE telegram_id=?`, args: [Number(w.amount || 0), verified.id] });
      await addTransaction(verified.id, "WITHDRAW", Number(w.amount || 0), "Refunded", `Cancelled ${id}`);
    }
    const user = await getUser(verified.id);
    res.json({ ok: true, balance: Number(user.balance || 0) });
  } catch (e) { console.error("/api/withdraw/cancel", e); res.status(500).json({ error: "Withdrawal cancellation failed" }); }
});

async function start() {
  try {
    await initDB();
    app.listen(PORT, () => console.log(`SINAPS backend v4.1.0 running on ${PORT}`));
  } catch (e) { console.error("Startup error:", e); process.exit(1); }
}
start();
