const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

const {
  TonClient,
  WalletContractV5R1,
  SendMode,
  internal,
  beginCell,
  Address,
  JettonMaster
} = require("@ton/ton");

const {
  mnemonicToPrivateKey
} = require("@ton/crypto");

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-Telegram-Init-Data"
  ]
}));

app.use(express.json({
  limit: "1mb"
}));

const PORT =
  process.env.PORT || 10000;

const DB_URL =
  process.env.TURSO_DATABASE_URL;

const DB_TOKEN =
  process.env.TURSO_AUTH_TOKEN;

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "SNPCOINBot";


// ============================================================
// SINAPS / TON CONFIG
// ============================================================

const TREASURY_WALLET =
  process.env.TREASURY_WALLET ||
  "UQDMsJu14wu-EHSjaRpufQdPb73pKVRkQvHNezgA2zF69sJX";

const SNP_CONTRACT =
  process.env.SNP_CONTRACT ||
  "EQAmLlerUViNn9PwFVRlR_AjDvhd5pkmeLNOu5bNDpvXV0ls";

const TONCENTER =
  process.env.TONCENTER_API ||
  "https://toncenter.com/api/v3";

const TONCENTER_API_KEY =
  process.env.TONCENTER_API_KEY ||
  "";

const TON_RPC =
  process.env.TON_RPC ||
  "https://toncenter.com/api/v2/jsonRPC";

const TREASURY_MNEMONIC =
  process.env.TREASURY_MNEMONIC ||
  "";

const WITHDRAW_FEE_NANO_PER_SNP = 10000n; // 0.1 TON per 10,000 SNP
const MIN_WITHDRAW_HOLDING_SNP = 50000;

const SNP_DECIMALS =
  9;

const TREASURY_JETTON_GAS =
  process.env.TREASURY_JETTON_GAS ||
  "0.06";

const ENERGY_REGEN_SECONDS =
  3;

const REFERRAL_RATE =
  0.15;

const REFERRAL_JOIN_REWARD =
  10;

const HOLDER_MIN_SNP =
  50000;


if (
  !DB_URL ||
  !DB_TOKEN ||
  !BOT_TOKEN
) {
  console.error(
    "Missing TURSO_DATABASE_URL, TURSO_AUTH_TOKEN or TELEGRAM_BOT_TOKEN"
  );

  process.exit(1);
}


const db =
  createClient({
    url: DB_URL,
    authToken: DB_TOKEN
  });


// ============================================================
// TREASURY STATE
// ============================================================

let treasuryInitPromise = null;
let treasuryKeyPair = null;
let treasuryTonClient = null;
let treasuryWallet = null;
let treasuryJettonWallet = null;


// ============================================================
// BOOSTS
// ============================================================

const BOOST_LEVELS = {

  tap: [
    { level: 2, price: 2000, name: "Tap ×2", description: "0.1 SNP per tap" },
    { level: 3, price: 3000, name: "Tap ×3", description: "0.2 SNP per tap" },
    { level: 4, price: 5000, name: "Tap ×4", description: "0.3 SNP per tap" },
    { level: 5, price: 8000, name: "Tap ×5", description: "0.4 SNP per tap" },
    { level: 6, price: 10000, name: "Tap ×6", description: "0.5 SNP per tap" },
    { level: 7, price: 12000, name: "Tap ×7", description: "0.6 SNP per tap" },
    { level: 8, price: 15000, name: "Tap ×8", description: "0.7 SNP per tap" },
    { level: 9, price: 18000, name: "Tap ×9", description: "0.8 SNP per tap" },
    { level: 10, price: 22000, name: "Tap ×10", description: "0.9 SNP per tap" }
  ],

  energy: [
    {
      level: 2,
      price: 2000,
      name: "Energy ×2",
      description: "Maximum 2,000 energy"
    },
    {
      level: 3,
      price: 3500,
      name: "Energy ×3",
      description: "Maximum 3,000 energy"
    },
    {
      level: 4,
      price: 6000,
      name: "Energy ×4",
      description: "Maximum 4,000 energy"
    },
    {
      level: 5,
      price: 10000,
      name: "Energy ×5",
      description: "Maximum 5,000 energy"
    }
  ],

  recharge: [
    {
      level: 2,
      price: 1500,
      name: "Recharge ×2",
      description: "Energy regenerates 2× faster"
    },
    {
      level: 3,
      price: 3000,
      name: "Recharge ×3",
      description: "Energy regenerates 3× faster"
    },
    {
      level: 4,
      price: 4500,
      name: "Recharge ×4",
      description: "Energy regenerates 4× faster"
    },
    {
      level: 5,
      price: 6500,
      name: "Recharge ×5",
      description: "Energy regenerates 5× faster"
    }
  ]

};


// ============================================================
// EXACT 9 SINAPS TASKS
// ============================================================

const TASKS = [

  {
    id: "channel",
    name: "Join SINAPS Channel",
    title: "Join SINAPS Channel",
    icon: "📢",
    reward: 10,
    type: "telegram",
    chat: "@SINAPS_COIN",
    url: "https://t.me/SINAPS_COIN"
  },

  {
    id: "group",
    name: "Join SINAPS Group",
    title: "Join SINAPS Group",
    icon: "👥",
    reward: 7,
    type: "telegram",
    chat: "@SINAPS_Group",
    url: "https://t.me/SINAPS_Group"
  },

  {
    id: "withdrawals_channel",
    name: "Join SINAPS Withdrawals Channel",
    title: "Join SINAPS Withdrawals Channel",
    icon: "💸",
    reward: 10,
    type: "telegram",
    chat: "@SINAPS_Withdrawals",
    url: "https://t.me/SINAPS_Withdrawals"
  },

  {
    id: "holder",
    name: "Hold 50,000 SNP",
    title: "Hold 50,000 SNP",
    icon: "💎",
    reward: 100,
    type: "holder",
    required: HOLDER_MIN_SNP,
    url: "#"
  },

  {
    id: "twitter",
    name: "Follow SINAPS on X",
    title: "Follow SINAPS on X",
    icon: "𝕏",
    reward: 10,
    type: "external",
    url: "https://x.com/SINAPS_SNP"
  },

  {
    id: "like_retweet",
    name: "Like & Repost SINAPS",
    title: "Like & Repost SINAPS",
    icon: "❤️",
    reward: 5,
    type: "external",
    url: "https://x.com/SINAPS_SNP/status/2099008238251311432"
  },

  {
    id: "connect_wallet",
    name: "Connect TON Wallet",
    title: "Connect TON Wallet",
    icon: "💎",
    reward: 5,
    type: "wallet",
    url: "#"
  },

  {
    id: "invite_3",
    name: "Invite 3 Friends",
    title: "Invite 3 Friends",
    icon: "👥",
    reward: 30,
    type: "referral",
    required: 3,
    url: "#"
  },

  {
    id: "invite_10",
    name: "Invite 10 Friends",
    title: "Invite 10 Friends",
    icon: "🔥",
    reward: 150,
    type: "referral",
    required: 10,
    url: "#"
  },

  {
    id: "invite_15",
    name: "Invite 15 Friends",
    title: "Invite 15 Friends",
    icon: "🚀",
    reward: 300,
    type: "referral",
    required: 15,
    url: "#"
  }

];


// ============================================================
// BASIC HELPERS
// ============================================================

function now() {
  return new Date().toISOString();
}


function dateOnly() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}


function randomCode() {
  return crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase();
}


function parseTime(value) {

  if (!value) {
    return Date.now();
  }

  const s =
    String(value);

  const normalized =
    /Z$|[+-]\d\d:\d\d$/.test(s)
      ? s
      : s.replace(" ", "T") + "Z";

  const t =
    Date.parse(normalized);

  return Number.isFinite(t)
    ? t
    : Date.now();
}


function dayDifference(a, b) {

  const aa =
    new Date(`${a}T00:00:00Z`)
      .getTime();

  const bb =
    new Date(`${b}T00:00:00Z`)
      .getTime();

  return Math.round(
    (bb - aa) / 86400000
  );
}


function safeInt(
  value,
  fallback = 0
) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? Math.floor(n)
    : fallback;
}


function snpRaw(amount) {

  const value =
    Number(amount);

  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(
      "Invalid SNP payout amount"
    );
  }

  return BigInt(
    Math.floor(value)
  ) *
    1000000000n;
}


function normalizeAddress(address) {

  return Address.parse(
    String(address).trim()
  ).toRawString();

}


// ============================================================
// TELEGRAM AUTH
// ============================================================

function verifyTelegram(initData) {

  try {

    if (
      !initData ||
      !BOT_TOKEN
    ) {
      return null;
    }

    const params =
      new URLSearchParams(
        initData
      );

    const hash =
      params.get("hash");

    if (!hash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString =
      [...params.entries()]
        .sort(
          ([a], [b]) =>
            a.localeCompare(b)
        )
        .map(
          ([k, v]) =>
            `${k}=${v}`
        )
        .join("\n");

    const secret =
      crypto
        .createHmac(
          "sha256",
          "WebAppData"
        )
        .update(BOT_TOKEN)
        .digest();

    const expected =
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(dataCheckString)
        .digest("hex");

    if (
      expected.length !==
      hash.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(hash)
      )
    ) {
      return null;
    }

    const authDate =
      Number(
        params.get("auth_date") ||
        0
      );

    const current =
      Math.floor(
        Date.now() / 1000
      );

    if (
      !authDate ||
      Math.abs(
        current - authDate
      ) > 86400
    ) {
      return null;
    }

    const user =
      JSON.parse(
        params.get("user") ||
        "{}"
      );

    if (!user.id) {
      return null;
    }

    return {
      id:
        String(user.id),

      username:
        user.username || ""
    };

  } catch (error) {

    console.error(
      "Telegram auth:",
      error.message
    );

    return null;
  }

}


function auth(req) {

  return verifyTelegram(
    req.headers[
      "x-telegram-init-data"
    ]
  );

}


function requireAuth(
  req,
  res
) {

  const user =
    auth(req);

  if (!user?.id) {

    res.status(401).json({
      error:
        "Telegram authentication required"
    });

    return null;
  }

  return user;
}


// ============================================================
// DATABASE HELPERS
// ============================================================

async function getUser(
  telegramId
) {

  const result =
    await db.execute({

      sql: `
        SELECT *
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,

      args: [
        String(telegramId)
      ]
    });

  return (
    result.rows[0] ||
    null
  );
}


function publicUser(user) {

  if (!user) {
    return null;
  }

  return {

    telegram_id:
      String(user.telegram_id),

    username:
      user.username || "",

    balance:
      Number(user.balance || 0),

    energy:
      Number(user.energy || 0),

    max_energy:
      Number(
        user.max_energy || 1000
      ),

    tap_power:
      Number(
        user.tap_power || 1
      ),

    tap_boost_level:
      Number(
        user.tap_boost_level || 1
      ),

    energy_boost_level:
      Number(
        user.energy_boost_level || 1
      ),

    recharge_multiplier:
      Number(
        user.recharge_multiplier || 1
      ),

    recharge_level:
      Number(
        user.recharge_level || 1
      ),

    wallet_address:
      user.wallet_address ||
      null,

    referral_code:
      user.referral_code ||
      "",

    referral_rewarded:
      Number(
        user.referral_rewarded || 0
      )

  };

}


async function addTransaction(
  telegramId,
  type,
  amount,
  status,
  details
) {

  await db.execute({

    sql: `
      INSERT INTO transactions
      (
        telegram_id,
        type,
        amount,
        status,
        details,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,

    args: [
      String(telegramId),
      type,
      Number(amount),
      status,
      details || "",
      now()
    ]
  });

}


// ============================================================
// ENERGY
// ============================================================

async function syncEnergy(
  telegramId
) {

  const user =
    await getUser(
      telegramId
    );

  if (!user) {
    return null;
  }

  const maxEnergy =
    Math.max(
      1,
      Number(
        user.max_energy || 1000
      )
    );

  const energy =
    Math.max(
      0,
      Number(
        user.energy || 0
      )
    );

  const multiplier =
    Math.max(
      1,
      Number(
        user.recharge_multiplier || 1
      )
    );

  const last =
    parseTime(
      user.last_energy_update
    );

  const interval =
    (
      ENERGY_REGEN_SECONDS *
      1000
    ) /
    multiplier;

  const gained =
    Math.floor(
      Math.max(
        0,
        Date.now() - last
      ) /
      interval
    );

  if (gained <= 0) {
    return user;
  }

  const newEnergy =
    Math.min(
      maxEnergy,
      energy + gained
    );

  const newTime =
    newEnergy >= maxEnergy
      ? now()
      : new Date(
          last +
          gained * interval
        ).toISOString();

  await db.execute({

    sql: `
      UPDATE users
      SET
        energy = ?,
        last_energy_update = ?
      WHERE telegram_id = ?
    `,

    args: [
      newEnergy,
      newTime,
      String(telegramId)
    ]
  });

  return getUser(
    telegramId
  );
}


// ============================================================
// REFERRALS
// ============================================================

async function getReferralCount(
  telegramId
) {

  const result =
    await db.execute({

      sql: `
        SELECT COUNT(*) AS total
        FROM users
        WHERE referred_by = ?
          AND telegram_id != ?
      `,

      args: [
        String(telegramId),
        String(telegramId)
      ]
    });

  return Number(
    result.rows[0]?.total || 0
  );
}


async function rewardReferralOwner(
  telegramId,
  rewardAmount,
  source
) {

  const user =
    await getUser(
      telegramId
    );

  if (
    !user?.referred_by ||
    !user?.wallet_address ||
    Number(user?.referral_rewarded || 0) !== 1 ||
    String(user.referred_by) === String(user.telegram_id) ||
    Number(rewardAmount) <= 0
  ) {
    return 0;
  }

  const bonus =
    Math.floor(
      Number(rewardAmount) *
      REFERRAL_RATE
    );

  if (bonus <= 0) {
    return 0;
  }

  const result =
    await db.execute({

      sql: `
        UPDATE users
        SET balance = balance + ?
        WHERE telegram_id = ?
      `,

      args: [
        bonus,
        String(user.referred_by)
      ]
    });

  if (result.rowsAffected) {

    await addTransaction(
      user.referred_by,
      "REFERRAL",
      bonus,
      "Completed",
      `${source} referral bonus`
    );
  }

  return bonus;
}


async function qualifyReferral(telegramId) {
  let tx;
  try {
    tx = await db.transaction("write");
    const userResult = await tx.execute({
      sql: `SELECT telegram_id, referred_by, wallet_address, referral_rewarded
            FROM users WHERE telegram_id = ? LIMIT 1`,
      args: [String(telegramId)]
    });
    const user = userResult.rows[0];
    if (!user || !user.referred_by || !user.wallet_address ||
        Number(user.referral_rewarded || 0) === 1 ||
        String(user.referred_by) === String(user.telegram_id)) {
      await tx.rollback();
      return 0;
    }

    const inviterResult = await tx.execute({
      sql: `SELECT telegram_id FROM users WHERE telegram_id = ? LIMIT 1`,
      args: [String(user.referred_by)]
    });
    if (!inviterResult.rows.length) {
      await tx.rollback();
      return 0;
    }

    const claimed = await tx.execute({
      sql: `UPDATE users SET referral_rewarded = 1
            WHERE telegram_id = ? AND referral_rewarded = 0
              AND referred_by = ? AND wallet_address IS NOT NULL
              AND wallet_address != ''`,
      args: [String(telegramId), String(user.referred_by)]
    });
    if (Number(claimed.rowsAffected || 0) !== 1) {
      await tx.rollback();
      return 0;
    }

    const credited = await tx.execute({
      sql: `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`,
      args: [REFERRAL_JOIN_REWARD, String(user.referred_by)]
    });
    if (Number(credited.rowsAffected || 0) !== 1) {
      throw new Error("Referral inviter balance could not be updated");
    }

    await tx.execute({
      sql: `INSERT INTO transactions
            (telegram_id, type, amount, status, details, created_at)
            VALUES (?, 'REFERRAL', ?, 'Completed', ?, ?)`,
      args: [
        String(user.referred_by),
        REFERRAL_JOIN_REWARD,
        `Referral reward for user ${String(telegramId)} connecting TON wallet`,
        now()
      ]
    });

    await tx.execute({
      sql: `INSERT OR IGNORE INTO spin_tickets (owner_telegram_id, invited_telegram_id, created_at) VALUES (?, ?, ?)`,
      args: [String(user.referred_by), String(telegramId), now()]
    });

    await tx.commit();
    return REFERRAL_JOIN_REWARD;
  } catch (error) {
    try { if (tx) await tx.rollback(); } catch (_) {}
    console.error("qualifyReferral error:", error);
    return 0;
  }
}

async function rewardUser(
  telegramId,
  amount,
  type,
  details
) {

  const value =
    Number(amount || 0);

  if (value <= 0) {
    return;
  }

  await db.execute({

    sql: `
      UPDATE users
      SET balance = balance + ?
      WHERE telegram_id = ?
    `,

    args: [
      value,
      String(telegramId)
    ]
  });

  await addTransaction(
    telegramId,
    type,
    value,
    "Completed",
    details
  );

  await rewardReferralOwner(
    telegramId,
    value,
    type
  );
}


// ============================================================
// DATABASE MIGRATION
// ============================================================

async function ensureColumn(
  table,
  column,
  definition
) {

  try {

    const result =
      await db.execute(
        `PRAGMA table_info(${table})`
      );

    const exists =
      result.rows.some(
        row =>
          String(row.name) ===
          String(column)
      );

    if (!exists) {

      console.log(
        `Adding missing column: ${table}.${column}`
      );

      await db.execute(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
      );

    }

  } catch (error) {

    if (
      String(error.message || "")
        .toLowerCase()
        .includes("duplicate column")
    ) {
      return;
    }

    throw error;
  }
}


async function initDB() {

  console.log(
    "Initializing SINAPS database..."
  );

await db.execute(`
  CREATE TABLE IF NOT EXISTS ad_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    platform TEXT NOT NULL,
    target_url TEXT NOT NULL,
    target_clicks INTEGER NOT NULL,
    valid_clicks INTEGER DEFAULT 0,
    price_gram REAL NOT NULL,
    reward_per_user INTEGER DEFAULT 0,
    budget_snp INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending_payment',
    payment_tx_hash TEXT,
    payment_verified INTEGER DEFAULT 0,
    admin_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS ad_task_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    telegram_id TEXT NOT NULL,
    clicked_at TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    review_note TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT,
    reward_paid INTEGER DEFAULT 0,
    UNIQUE (task_id, telegram_id)
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS ad_link_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    telegram_id TEXT NOT NULL,
    clicked_at TEXT NOT NULL,
    UNIQUE (task_id, telegram_id)
  )
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS idx_ad_link_clicks_task
  ON ad_link_clicks(task_id)
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS idx_ad_tasks_status
  ON ad_tasks(status)
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS idx_ad_tasks_owner
  ON ad_tasks(telegram_id)
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS idx_ad_task_clicks_task
  ON ad_task_clicks(task_id)
`);


  const userColumns = [

    ["username", "TEXT"],
    ["balance", "INTEGER DEFAULT 0"],
    ["energy", "INTEGER DEFAULT 1000"],
    ["max_energy", "INTEGER DEFAULT 1000"],
    ["last_energy_update", "TEXT"],
    ["created_at", "TEXT"],
    ["last_daily_bonus", "TEXT"],
    ["daily_streak", "INTEGER DEFAULT 0"],
    ["referral_code", "TEXT"],
    ["referred_by", "TEXT"],
    ["wallet_address", "TEXT"],
    ["tap_power", "REAL DEFAULT 0.1"],
    ["tap_boost_level", "INTEGER DEFAULT 1"],
    ["energy_boost_level", "INTEGER DEFAULT 1"],
    ["recharge_multiplier", "INTEGER DEFAULT 1"],
    ["recharge_level", "INTEGER DEFAULT 1"],
    ["referral_rewarded", "INTEGER DEFAULT 0"],
    ["referral_mining_remainder", "REAL DEFAULT 0"]

  ];


  for (
    const [column, definition]
    of userColumns
  ) {

    await ensureColumn(
      "users",
      column,
      definition
    );

  }


  await db.execute(`

    CREATE TABLE IF NOT EXISTS transactions (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      telegram_id TEXT NOT NULL,

      type TEXT,

      amount INTEGER,

      status TEXT,

      details TEXT,

      created_at TEXT

    )

  `);


  await db.execute(`

    CREATE TABLE IF NOT EXISTS task_claims (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      telegram_id TEXT NOT NULL,

      task_id TEXT NOT NULL,

      reward INTEGER NOT NULL,

      status TEXT,

      created_at TEXT,

      UNIQUE(telegram_id, task_id)

    )

  `);


  await db.execute(`

    CREATE TABLE IF NOT EXISTS daily_rewards (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      telegram_id TEXT NOT NULL,

      day INTEGER NOT NULL,

      reward INTEGER NOT NULL,

      claimed_at TEXT,

      UNIQUE(telegram_id, day)

    )

  `);


  await db.execute(`
    CREATE TABLE IF NOT EXISTS spin_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      day_key TEXT NOT NULL,
      reward INTEGER NOT NULL,
      prize_index INTEGER NOT NULL,
      created_at TEXT,
      UNIQUE(telegram_id, day_key)
    )
  `);

  await db.execute(`CREATE TABLE IF NOT EXISTS spin_free_claims (
    telegram_id TEXT PRIMARY KEY, claimed_at TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS spin_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner_telegram_id TEXT NOT NULL, invited_telegram_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, used_at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS spin_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, spin_number INTEGER NOT NULL, ticket_id INTEGER, spin_kind TEXT NOT NULL, prize_type TEXT NOT NULL, reward REAL NOT NULL DEFAULT 0, prize_index INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(telegram_id, spin_number)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_migrations (migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const scaleMigration = await db.execute({ sql: `SELECT migration_key FROM app_migrations WHERE migration_key = ? LIMIT 1`, args: ["balance_scale_10x_20261016"] });
  if (!scaleMigration.rows.length) {
    await db.execute(`UPDATE users SET balance = CAST(balance AS REAL) / 10`);
    await db.execute({ sql: `INSERT INTO app_migrations (migration_key, applied_at) VALUES (?, ?)`, args: ["balance_scale_10x_20261016", now()] });
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS spin_ton_payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spin_history_id INTEGER NOT NULL UNIQUE,
    telegram_id TEXT NOT NULL,
    wallet_address TEXT,
    amount_ton TEXT NOT NULL DEFAULT '0.1',
    status TEXT NOT NULL DEFAULT 'pending',
    payout_query_id TEXT,
    payout_tx_hash TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    submitted_at TEXT,
    completed_at TEXT
  )`);

  await db.execute(`

    CREATE TABLE IF NOT EXISTS boost_purchases (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      telegram_id TEXT NOT NULL,

      boost_id TEXT NOT NULL,

      boost_type TEXT NOT NULL,

      level INTEGER NOT NULL,

      price INTEGER NOT NULL,

      created_at TEXT

    )

  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS recurring_task_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      reward INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_recurring_task_user ON recurring_task_claims(telegram_id, task_id, created_at)`);

  await db.execute(`

    CREATE TABLE IF NOT EXISTS withdrawals (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      withdrawal_id TEXT UNIQUE,

      telegram_id TEXT,

      wallet_address TEXT,

      amount INTEGER,

      fee_ton TEXT,

      fee_nano TEXT,

      treasury_wallet TEXT,

      token_contract TEXT,

      status TEXT DEFAULT 'payment_pending',

      fee_tx_hash TEXT,

      payout_tx_hash TEXT,

      payout_query_id TEXT,

      payout_submitted_at TEXT,

      created_at TEXT,

      verified_at TEXT,

      completed_at TEXT

    )

  `);


  const withdrawalColumns = [

    ["payout_tx_hash", "TEXT"],
    ["payout_query_id", "TEXT"],
    ["payout_submitted_at", "TEXT"]

  ];


  for (
    const [column, definition]
    of withdrawalColumns
  ) {

    await ensureColumn(
      "withdrawals",
      column,
      definition
    );

  }


  await db.execute(`
    UPDATE users
    SET tap_power = 0.1
    WHERE tap_power IS NULL
  `);

  await db.execute(`
    UPDATE users
    SET tap_boost_level = 1
    WHERE tap_boost_level IS NULL
  `);

  await db.execute(`
    UPDATE users
    SET energy_boost_level = 1
    WHERE energy_boost_level IS NULL
  `);

  await db.execute(`
    UPDATE users
    SET recharge_multiplier = 1
    WHERE recharge_multiplier IS NULL
  `);

  await db.execute(`
    UPDATE users
    SET recharge_level = 1
    WHERE recharge_level IS NULL
  `);

  await db.execute(`
    UPDATE users
    SET referral_rewarded = 0
    WHERE referral_rewarded IS NULL
  `);


  const oldUsers =
    await db.execute(`

      SELECT telegram_id
      FROM users
      WHERE referral_code IS NULL
         OR referral_code = ''
      LIMIT 1000

    `);


  for (
    const row of oldUsers.rows
  ) {

    let code =
      randomCode();

    let exists =
      await db.execute({

        sql: `
          SELECT telegram_id
          FROM users
          WHERE referral_code = ?
          LIMIT 1
        `,

        args: [
          code
        ]
      });


    while (
      exists.rows.length
    ) {

      code =
        randomCode();

      exists =
        await db.execute({

          sql: `
            SELECT telegram_id
            FROM users
            WHERE referral_code = ?
            LIMIT 1
            `,

          args: [
            code
          ]
        });
    }


    await db.execute({

      sql: `
        UPDATE users
        SET referral_code = ?
        WHERE telegram_id = ?
      `,

      args: [
        code,
        String(row.telegram_id)
      ]
    });
  }


  console.log(
    "SINAPS database migration completed successfully."
  );
}


// ============================================================
// TELEGRAM API (WITH SAFE TIMEOUT & ABORT CONTROLLER)
// ============================================================

async function telegramApi(
  method,
  body
) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response =
      await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(body),

          signal: controller.signal
        }
      ).finally(() => clearTimeout(timeout));

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (
      !response.ok ||
      !data.ok
    ) {
      console.error(`Telegram API error on ${method}:`, data.description || response.statusText);
      return null;
    }

    return data.result;
  } catch (error) {
    console.error(`Telegram API fetch failed for ${method}:`, error.message);
    return null;
  }
}


async function isTelegramMember(
  chat,
  telegramId
) {
  try {
    const member =
      await telegramApi(
        "getChatMember",
        {
          chat_id:
            chat,

          user_id:
            telegramId
        }
      );

    if (!member) return false;

    return (

      [
        "creator",
        "administrator",
        "member"
      ].includes(
        member.status
      )

      ||

      (
        member.status ===
        "restricted" &&
        member.is_member === true
      )

    );
  } catch (e) {
    console.error("isTelegramMember error:", e.message);
    return false;
  }
}


// ============================================================
// ROOT
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.json({

      project:
        "SINAPS",

      status:
        "online",

      version:
        "5.0.0"

    });

  }
);


// ============================================================
// USER
// ============================================================

app.post(
  "/api/user",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const telegramId =
        String(verified.id);

      const username =
        verified.username ||
        "";

      const startParam =
        String(
          req.body.start_param ||
          ""
        )
          .trim()
          .toUpperCase();

      let user =
        await getUser(
          telegramId
        );


      if (!user) {

        let referralCode =
          randomCode();

        while (
          (
            await db.execute({

              sql: `
                SELECT telegram_id
                FROM users
                WHERE referral_code = ?
                LIMIT 1
              `,

              args: [
                referralCode
              ]

            })
          ).rows.length
        ) {

          referralCode =
            randomCode();

        }


        let referredBy =
          null;


        if (startParam) {

          const ref =
            await db.execute({

              sql: `
                SELECT telegram_id
                FROM users
                WHERE referral_code = ?
                LIMIT 1
              `,

              args: [
                startParam
              ]

            });


          if (
            ref.rows.length &&
            String(
              ref.rows[0].telegram_id
            ) !==
            telegramId
          ) {

            referredBy =
              String(
                ref.rows[0].telegram_id
              );

          }

        }


        await db.execute({

          sql: `
            INSERT INTO users
            (
              telegram_id,
              username,
              balance,
              energy,
              max_energy,
              last_energy_update,
              created_at,
              last_daily_bonus,
              daily_streak,
              referral_code,
              referred_by,
              tap_power,
              tap_boost_level,
              energy_boost_level,
              recharge_multiplier,
              recharge_level,
              referral_rewarded
            )
            VALUES
            (
              ?,
              ?,
              0,
              1000,
              1000,
              ?,
              ?,
              NULL,
              0,
              ?,
              ?,
              1,
              1,
              1,
              1,
              1,
              0
            )
          `,

          args: [

            telegramId,
            username,
            now(),
            now(),
            referralCode,
            referredBy

          ]
        });


        user =
          await getUser(
            telegramId
          );

      } else {

        await db.execute({
          sql: `UPDATE users SET username = ? WHERE telegram_id = ?`,
          args: [username, telegramId]
        });

        if (startParam && !user.referred_by) {
          const ref = await db.execute({
            sql: `SELECT telegram_id FROM users WHERE referral_code = ? LIMIT 1`,
            args: [startParam]
          });
          const inviterId = ref.rows[0]?.telegram_id ? String(ref.rows[0].telegram_id) : "";
          if (inviterId && inviterId !== telegramId) {
            await db.execute({
              sql: `UPDATE users SET referred_by = ?
                    WHERE telegram_id = ? AND (referred_by IS NULL OR referred_by = '')`,
              args: [inviterId, telegramId]
            });
          }
        }
      }

      user = await syncEnergy(telegramId);
      const referralReward = await qualifyReferral(telegramId);
      user = await getUser(telegramId);

      res.json({
        ok: true,
        referral_reward: referralReward,
        user: publicUser(user)
      });

    } catch (error) {

      console.error(
        "/api/user",
        error
      );

      res.status(500).json({

        error:
          "User load failed"

      });
    }
  }
);


// ============================================================
// TAP
// ============================================================


app.post(
  "/api/tap",
  async (req, res) => {
    let tx;

    try {
      const verified = requireAuth(req, res);
      if (!verified) return;

      const telegramId = String(verified.id);

      const requestId = String(
        req.body.request_id ||
        `legacy-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`
      ).trim();

      if (requestId.length > 120 || !requestId) {
        return res.status(400).json({
          error: "Invalid tap request ID"
        });
      }

      const count = Math.min(
        50,
        Math.max(1, safeInt(req.body.count, 1))
      );

      await syncEnergy(telegramId);

      tx = await db.transaction("write");

      const inserted = await tx.execute({
        sql: `
          INSERT OR IGNORE INTO tap_requests
          (telegram_id, request_id, count, created_at)
          VALUES (?, ?, ?, ?)
        `,
        args: [telegramId, requestId, count, now()]
      });

      if (Number(inserted.rowsAffected || 0) !== 1) {
        const previous = await tx.execute({
          sql: `
            SELECT count FROM tap_requests
            WHERE telegram_id = ? AND request_id = ?
            LIMIT 1
          `,
          args: [telegramId, requestId]
        });

        await tx.commit();
        tx = null;

        if (
          !previous.rows.length ||
          Number(previous.rows[0].count) !== count
        ) {
          return res.status(409).json({
            error: "Tap request ID conflict"
          });
        }

        const currentUser = await getUser(telegramId);

        return res.json({
          ok: true,
          duplicate: true,
          user: publicUser(currentUser)
        });
      }

      const result = await tx.execute({
        sql: `
          SELECT energy, tap_power, referred_by, wallet_address,
                 referral_rewarded, referral_mining_remainder
          FROM users
          WHERE telegram_id = ?
          LIMIT 1
        `,
        args: [telegramId]
      });

      const user = result.rows[0];

      if (!user) {
        await tx.rollback();
        tx = null;

        return res.status(404).json({
          error: "User not found"
        });
      }

      const energy = Math.max(0, Number(user.energy || 0));
      const tapPower = Math.max(0.1, Number(user.tap_power || 0.1));
      const usable = Math.min(count, energy);

      if (usable <= 0) {
        await tx.rollback();
        tx = null;

        return res.status(400).json({
          error: "No energy",
          user: publicUser(await getUser(telegramId))
        });
      }

      const reward = usable * tapPower;

      const mineResult = await tx.execute({
        sql: `
          UPDATE users
          SET balance = balance + ?,
              energy = energy - ?,
              last_energy_update = ?
          WHERE telegram_id = ? AND energy >= ?
        `,
        args: [reward, usable, now(), telegramId, usable]
      });

      if (Number(mineResult.rowsAffected || 0) !== 1) {
        throw new Error("Tap conflict. Try again.");
      }

      let referralCommission = 0;

      const inviterId = user.referred_by
        ? String(user.referred_by)
        : "";

      if (
        user.wallet_address &&
        Number(user.referral_rewarded || 0) === 1 &&
        inviterId &&
        inviterId !== telegramId
      ) {
        const accrued =
          Number(user.referral_mining_remainder || 0) +
          reward * REFERRAL_RATE;

        referralCommission = Math.floor(accrued + 1e-9);

        const remainder = Math.max(
          0,
          accrued - referralCommission
        );

        await tx.execute({
          sql: `
            UPDATE users
            SET referral_mining_remainder = ?
            WHERE telegram_id = ?
          `,
          args: [remainder, telegramId]
        });

        if (referralCommission > 0) {
          const inviterUpdate = await tx.execute({
            sql: `
              UPDATE users
              SET balance = balance + ?
              WHERE telegram_id = ?
            `,
            args: [referralCommission, inviterId]
          });

          if (Number(inviterUpdate.rowsAffected || 0) !== 1) {
            throw new Error(
              "Referral commission could not be credited"
            );
          }

          await tx.execute({
            sql: `
              INSERT INTO transactions
              (telegram_id, type, amount, status, details, created_at)
              VALUES (?, 'REFERRAL', ?, 'Completed', ?, ?)
            `,
            args: [
              inviterId,
              referralCommission,
              `15% mining commission from referral ${telegramId}`,
              now()
            ]
          });
        }
      }

      await tx.commit();
      tx = null;

      const updated = await getUser(telegramId);

      return res.json({
        ok: true,
        duplicate: false,
        taps: usable,
        reward,
        referral_commission: referralCommission,
        user: publicUser(updated)
      });

    } catch (error) {
      if (tx) {
        try {
          await tx.rollback();
        } catch (_) {}
      }

      console.error("/api/tap", error);

      if (
        String(error.message || "")
          .toLowerCase()
          .includes("tap conflict")
      ) {
        return res.status(409).json({
          error: "Tap conflict. Try again."
        });
      }

      return res.status(500).json({
        error: "Tap failed"
      });
    }
  }
);

 
// ============================================================
// BOOST HELPERS
// ============================================================

function getBoostLevel(
  user,
  type
) {

  if (
    type === "tap"
  ) {

    return Number(
      user.tap_boost_level ||
      1
    );

  }

  if (
    type === "energy"
  ) {

    return Number(
      user.energy_boost_level ||
      1
    );

  }

  return Number(
    user.recharge_level ||
    1
  );
}


// ============================================================
// GET BOOSTS
// ============================================================

app.get(
  "/api/boosts",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const user =
        await syncEnergy(
          verified.id
        );

      if (!user) {

        return res.status(404)
          .json({
            error:
              "User not found"
          });
      }

      const boosts =
        Object.entries(
          BOOST_LEVELS
        ).map(
          ([type, levels]) => {

            const current =
              getBoostLevel(
                user,
                type
              );

            const next =
              levels.find(
                x =>
                  x.level ===
                  current + 1
              );

            return {

              type,

              current_level:
                current,

              max_level:
                levels.at(-1).level,

              next:
                next
                  ? {
                      ...next,

                      icon:
                        type === "tap"
                          ? "⚡"
                          : type === "energy"
                            ? "🔋"
                            : "🚀"
                    }
                  : null
            };
          }
        );


      res.json({

        ok:
          true,

        balance:
          Number(
            user.balance || 0
          ),

        boosts

      });

    } catch (error) {

      console.error(
        "/api/boosts",
        error
      );

      res.status(500).json({
        error:
          "Failed to load boosts"
      });
    }
  }
);


// ============================================================
// BUY BOOST
// ============================================================

app.post(
  "/api/boosts/buy",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const telegramId =
        verified.id;

      const user =
        await syncEnergy(
          telegramId
        );

      if (!user) {

        return res.status(404)
          .json({
            error:
              "User not found"
          });
      }

      const type =
        String(
          req.body.type || ""
        );

      if (
        !BOOST_LEVELS[type]
      ) {

        return res.status(400)
          .json({
            error:
              "Invalid boost type"
          });
      }

      const current =
        getBoostLevel(
          user,
          type
        );

      const next =
        BOOST_LEVELS[type].find(
          x =>
            x.level ===
            current + 1
        );

      if (!next) {

        return res.status(400)
          .json({
            error:
              "Maximum level reached"
          });
      }

      const deducted =
        await db.execute({

          sql: `
            UPDATE users
            SET balance = balance - ?
            WHERE telegram_id = ?
              AND balance >= ?
          `,

          args: [
            next.price,
            telegramId,
            next.price
          ]
        });


      if (
        !deducted.rowsAffected
      ) {

        return res.status(400)
          .json({
            error:
              `Not enough SNP. Need ${next.price} SNP.`
          });
      }


      if (
        type === "tap"
      ) {

        await db.execute({

          sql: `
            UPDATE users
            SET
              tap_power = ?,
              tap_boost_level = ?
            WHERE telegram_id = ?
          `,

          args: [
            Number((next.level - 1) / 10),
            next.level,
            telegramId
          ]
        });

      }


      if (
        type === "energy"
      ) {

        const newMax =
          next.level *
          1000;

        const oldMax =
          Number(
            user.max_energy ||
            1000
          );

        const oldEnergy =
          Number(
            user.energy ||
            0
          );

        const newEnergy =
          Math.min(
            newMax,
            oldEnergy +
            Math.max(
              0,
              newMax -
              oldMax
            )
          );

        await db.execute({

          sql: `
            UPDATE users
            SET
              max_energy = ?,
              energy = ?,
              energy_boost_level = ?
            WHERE telegram_id = ?
          `,

          args: [
            newMax,
            newEnergy,
            next.level,
            telegramId
          ]
        });
      }


      if (
        type === "recharge"
      ) {

        await db.execute({

          sql: `
            UPDATE users
            SET
              recharge_multiplier = ?,
              recharge_level = ?
            WHERE telegram_id = ?
          `,

          args: [
            Number((next.level - 1) / 10),
            next.level,
            telegramId
          ]
        });
      }


      await db.execute({

        sql: `
          INSERT INTO boost_purchases
          (
            telegram_id,
            boost_id,
            boost_type,
            level,
            price,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,

        args: [
          telegramId,
          `${type}${next.level}`,
          type,
          next.level,
          next.price,
          now()
        ]
      });


      await addTransaction(
        telegramId,
        "BOOST",
        -next.price,
        "Completed",
        `Purchased ${next.name}`
      );


      const updated =
        await getUser(
          telegramId
        );


      res.json({

        ok:
          true,

        message:
          `${next.name} activated`,

        user:
          publicUser(updated)

      });

    } catch (error) {

      console.error(
        "/api/boosts/buy",
        error
      );

      res.status(500).json({
        error:
          "Boost purchase failed"
      });
    }
  }
);


// ============================================================
// DAILY
// ============================================================

function getDailyStatus(
  user
) {

  const today =
    dateOnly();

  const last =
    user?.last_daily_bonus
      ? String(
          user.last_daily_bonus
        ).slice(0, 10)
      : null;

  const streak =
    Math.max(
      0,
      Number(
        user?.daily_streak ||
        0
      )
    );

  const claimedToday =
    last === today;

  let nextDay = 1;


  if (
    claimedToday
  ) {

    nextDay =
      Math.max(
        1,
        Math.min(
          30,
          streak
        )
      );

  } else if (
    last &&
    dayDifference(
      last,
      today
    ) === 1
  ) {

    nextDay =
      Math.max(
        1,
        Math.min(
          30,
          streak + 1
        )
      );
  }


  const claimedThrough =
    claimedToday
      ? Math.min(
          30,
          Math.max(
            0,
            streak
          )
        )
      : 0;


  const claimedDays =
    Array.from(
      {
        length:
          claimedThrough
      },
      (_, i) =>
        i + 1
    );


  return {

    streak,

    daily_streak:
      streak,

    current_streak:
      streak,

    last_claim_date:
      last,

    last_daily_bonus:
      last,

    claimed_today:
      claimedToday,

    claimedToday,

    today_claimed:
      claimedToday,

    todayClaimed:
      claimedToday,

    is_claimed:
      claimedToday,

    isClaimed:
      claimedToday,

    can_claim:
      !claimedToday,

    canClaim:
      !claimedToday,

    currentDay:
      claimedToday
        ? Math.max(
            1,
            Math.min(
              30,
              streak
            )
          )
        : nextDay,

    nextDay,

    reward:
      nextDay * 10,

    claimedDays

  };
}


app.get(
  "/api/daily",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const user =
        await getUser(
          verified.id
        );

      if (!user) {

        return res.status(404)
          .json({
            error:
              "User not found"
          });
      }

      const daily =
        getDailyStatus(
          user
        );

      res.json({
        ok: true,
        daily,
        ...daily
      });

    } catch (error) {

      console.error(
        "/api/daily",
        error
      );

      res.status(500).json({
        error:
          "Daily status failed"
      });
    }
  }
);


app.get(
  "/api/daily/status",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const user =
        await getUser(
          verified.id
        );

      if (!user) {

        return res.status(404)
          .json({
            error:
              "User not found"
          });
      }

      const daily =
        getDailyStatus(
          user
        );

      res.json({
        ok: true,
        ...daily
      });

    } catch (error) {

      console.error(
        "/api/daily/status",
        error
      );

      res.status(500).json({
        error:
          "Daily status failed"
      });
    }
  }
);


app.post(
  "/api/daily/claim",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const telegramId =
        verified.id;

      const user =
        await getUser(
          telegramId
        );

      if (!user) {

        return res.status(404)
          .json({
            error:
              "User not found"
          });
      }

      const today =
        dateOnly();

      const last =
        user.last_daily_bonus
          ? String(
              user.last_daily_bonus
            ).slice(0, 10)
          : null;


      if (
        last === today
      ) {

        const daily =
          getDailyStatus(
            user
          );

        return res.status(400)
          .json({

            ok: false,

            error:
              "Daily reward already claimed",

            claimed_today:
              true,

            claimedToday:
              true,

            can_claim:
              false,

            canClaim:
              false,

            daily

          });
      }


      let day = 1;

      if (
        last &&
        dayDifference(
          last,
          today
        ) === 1
      ) {

        day =
          Number(
            user.daily_streak ||
            0
          ) + 1;
      }


      if (day > 30) {
        day = 1;
      }


      const reward =
        day * 10;


      const updated =
        await db.execute({

          sql: `
            UPDATE users
            SET
              balance = balance + ?,
              daily_streak = ?,
              last_daily_bonus = ?
            WHERE telegram_id = ?
              AND
              (
                last_daily_bonus IS NULL
                OR
                substr(
                  last_daily_bonus,
                  1,
                  10
                ) <> ?
              )
          `,

          args: [
            reward,
            day,
            today,
            telegramId,
            today
          ]
        });


      if (
        Number(
          updated.rowsAffected || 0
        ) !== 1
      ) {

        return res.status(409)
          .json({
            ok: false,
            error:
              "Daily reward already claimed"
          });
      }


      await db.execute({

        sql: `
          INSERT INTO daily_rewards
          (
            telegram_id,
            day,
            reward,
            claimed_at
          )
          VALUES (?, ?, ?, ?)
        `,

        args: [
          telegramId,
          day,
          reward,
          now()
        ]
      });


      await addTransaction(
        telegramId,
        "DAILY",
        reward,
        "Completed",
        `Day ${day}`
      );


      await rewardReferralOwner(
        telegramId,
        reward,
        "DAILY"
      );


      const fresh =
        await getUser(
          telegramId
        );

      const daily =
        getDailyStatus(
          fresh
        );


      res.json({

        ok: true,

        day,

        reward,

        balance:
          Number(
            fresh.balance || 0
          ),

        claimed_today:
          true,

        claimedToday:
          true,

        can_claim:
          false,

        canClaim:
          false,

        last_claim_date:
          String(
            fresh.last_daily_bonus ||
            today
          ).slice(0, 10),

        last_daily_bonus:
          fresh.last_daily_bonus,

        streak:
          Number(
            fresh.daily_streak ||
            day
          ),

        daily

      });

    } catch (error) {

      console.error(
        "/api/daily/claim",
        error
      );

      res.status(500).json({
        error:
          "Daily claim failed"
      });
    }
  }
);


// ============================================================
// WALLET
// ============================================================

app.post(
  "/api/wallet/connect",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const wallet =
        String(
          req.body.wallet_address ||
          ""
        ).trim();

      let normalized;

      try {

        normalized =
          Address.parse(
            wallet
          ).toString();

      } catch {

        return res.status(400)
          .json({
            error:
              "Invalid TON wallet"
          });
      }


      await db.execute({

        sql: `
          UPDATE users
          SET wallet_address = ?
          WHERE telegram_id = ?
        `,

        args: [
          normalized,
          verified.id
        ]
      });


      const referralReward =
        await qualifyReferral(
          verified.id
        );


      const user =
        await getUser(
          verified.id
        );


      res.json({

        ok:
          true,

        wallet_address:
          normalized,

        referral_reward:
          referralReward,

        user:
          publicUser(user)

      });

    } catch (error) {

      console.error(
        "/api/wallet/connect",
        error
      );

      res.status(500).json({
        error:
          "Wallet save failed"
      });
    }
  }
);


app.post(
  "/api/wallet/disconnect",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      await db.execute({

        sql: `
          UPDATE users
          SET wallet_address = NULL
          WHERE telegram_id = ?
        `,

        args: [
          verified.id
        ]
      });


      res.json({

        ok:
          true,

        wallet_address:
          null

      });

    } catch (error) {

      console.error(
        "/api/wallet/disconnect",
        error
      );

      res.status(500).json({
        error:
          "Wallet disconnect failed"
      });
    }
  }
);


app.post(
  "/api/wallet/get",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }

      const user =
        await getUser(
          verified.id
        );

      res.json({

        ok:
          true,

        wallet_address:
          user?.wallet_address ||
          null

      });

    } catch (error) {

      console.error(
        "/api/wallet/get",
        error
      );

      res.status(500).json({
        error:
          "Wallet lookup failed"
      });
    }
  }
);


// ============================================================
// TASK STATUS
// ============================================================

async function getTaskStatus(
  telegramId
) {

  const recurringIds = new Set(["channel", "group", "withdrawals_channel", "twitter", "like_retweet"]);
  const claimedResult = await db.execute({
    sql: `SELECT task_id FROM task_claims WHERE telegram_id = ? AND status = 'Completed'`,
    args: [String(telegramId)]
  });
  const recurringResult = await db.execute({
    sql: `SELECT task_id, MAX(created_at) AS last_claimed FROM recurring_task_claims WHERE telegram_id = ? GROUP BY task_id`,
    args: [String(telegramId)]
  });
  const recurringLast = new Map(recurringResult.rows.map(row => [String(row.task_id), String(row.last_claimed || "")]));


  const claimed =
    new Set(
      claimedResult.rows.map(
        row =>
          String(row.task_id)
      )
    );


  const referralCount =
    await getReferralCount(
      telegramId
    );


  const user =
    await getUser(
      telegramId
    );


  const staticTasks = TASKS.map(
    task => {

      let completed = claimed.has(task.id);
      let cooldown_seconds = 0;
      if (recurringIds.has(String(task.id))) {
        const last = recurringLast.get(String(task.id));
        const lastMs = last ? new Date(last).getTime() : 0;
        cooldown_seconds = lastMs ? Math.max(0, Math.ceil((lastMs + 86400000 - Date.now()) / 1000)) : 0;
        completed = cooldown_seconds > 0;
      }


      if (
        task.type ===
        "referral"
      ) {

        const required =
          Number(
            task.required || 0
          );

        completed =
          completed &&
          referralCount >=
          required;

      }


      if (
        task.type ===
        "wallet"
      ) {

        completed =
          completed &&
          Boolean(
            user?.wallet_address
          );
      }


      return {

        ...task,

        completed,
        cooldown_seconds,

        referral_count:
          task.type === "referral"
            ? referralCount
            : undefined,

        action:
          task.type === "wallet"
            ? "CONNECT"
            : task.type === "holder"
              ? "VERIFY"
              : "VERIFY"

      };

    }
  );

  // Paid, active advertising tasks are shown in the main Tasks list to everyone
  // except their creator. My Ads remains the creator's management area only.
  const adResult = await db.execute({
    sql: `
      SELECT a.id, a.telegram_id, a.title, a.description, a.platform,
             a.target_url, a.reward_per_user, a.target_clicks, a.valid_clicks,
             (SELECT COUNT(*) FROM ad_task_clicks c
                WHERE c.task_id = a.id AND c.telegram_id = ?) AS completed_by_user,
             (SELECT c.clicked_at FROM ad_task_clicks c
                WHERE c.task_id = a.id AND c.telegram_id = ? LIMIT 1) AS last_clicked_at
      FROM ad_tasks a
      WHERE a.status = 'active'
        AND a.payment_verified = 1
        AND a.valid_clicks < a.target_clicks
        AND CAST(a.telegram_id AS TEXT) <> ?
      ORDER BY a.created_at ASC
    `,
    args: [String(telegramId), String(telegramId), String(telegramId)]
  });

  const adTasks = adResult.rows
    .map(ad => {
      const last = ad.last_clicked_at ? new Date(String(ad.last_clicked_at)).getTime() : 0;
      const cooldownSeconds = last ? Math.max(0, Math.ceil((last + 24 * 60 * 60 * 1000 - Date.now()) / 1000)) : 0;
      return ({
      id: `ad:${Number(ad.id)}`,
      type: "ad_task",
      name: String(ad.title || "Advertising task"),
      description: String(ad.description || ""),
      icon: "📢",
      url: String(ad.target_url || ""),
      reward: Number(ad.reward_per_user || 10),
      completed: cooldownSeconds > 0,
      cooldown_seconds: cooldownSeconds,
      platform: String(ad.platform || ""),
      valid_clicks: Number(ad.valid_clicks || 0),
      target_clicks: Number(ad.target_clicks || 0)
    });
    });

  return [...staticTasks, ...adTasks];
}


// ============================================================
// AUTOMATIC 0.1 TON SPIN PAYOUT
// ============================================================
async function submitSpinTonPayout(spinHistoryId) {
  const result = await db.execute({
    sql: `SELECT p.*, h.spin_number FROM spin_ton_payouts p JOIN spin_history h ON h.id = p.spin_history_id WHERE p.spin_history_id = ? LIMIT 1`,
    args: [Number(spinHistoryId)]
  });
  const payout = result.rows[0];
  if (!payout) throw new Error("Spin TON payout record not found");
  if (["submitted", "paid", "submitting", "review_required"].includes(String(payout.status))) return payout;

  const walletText = String(payout.wallet_address || "").trim();
  if (!walletText) {
    await db.execute({
      sql: `UPDATE spin_ton_payouts SET status = 'wallet_required', error_message = ? WHERE spin_history_id = ? AND status IN ('pending','wallet_required')`,
      args: ["Connect a TON wallet to receive this prize, then request payout again.", Number(spinHistoryId)]
    });
    return { ...payout, status: "wallet_required" };
  }

  const destination = Address.parse(walletText);
  await initTreasuryPayout();
  const queryId = crypto.randomBytes(8).readBigUInt64BE(0).toString();
  const reservation = await db.execute({
    sql: `UPDATE spin_ton_payouts SET status = 'submitting', wallet_address = ?, payout_query_id = ?, error_message = NULL WHERE spin_history_id = ? AND status IN ('pending','wallet_required')`,
    args: [destination.toString(), queryId, Number(spinHistoryId)]
  });
  if (Number(reservation.rowsAffected || 0) !== 1) {
    const latest = await db.execute({ sql: `SELECT * FROM spin_ton_payouts WHERE spin_history_id = ? LIMIT 1`, args: [Number(spinHistoryId)] });
    return latest.rows[0] || payout;
  }

  try {
    const openedWallet = treasuryTonClient.open(treasuryWallet);
    const seqno = await openedWallet.getSeqno();
    const comment = `SINAPS-SPIN:${Number(spinHistoryId)}:${queryId}`;
    const body = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
    const transfer = openedWallet.createTransfer({
      seqno,
      secretKey: treasuryKeyPair.secretKey,
      messages: [internal({ to: destination, value: "0.1", bounce: false, body })],
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      timeout: Math.floor(Date.now() / 1000) + 120
    });
    await openedWallet.send(transfer);
    const stamp = now();
    await db.execute({
      sql: `UPDATE spin_ton_payouts SET status = 'submitted', submitted_at = ?, error_message = NULL WHERE spin_history_id = ? AND status = 'submitting'`,
      args: [stamp, Number(spinHistoryId)]
    });
    await db.execute({
      sql: `UPDATE transactions SET status = 'Submitted', details = ? WHERE telegram_id = ? AND type = 'SPIN_TON' AND details LIKE ?`,
      args: [`0.1 TON payout submitted to ${destination.toString()}; correlation ${comment}; blockchain confirmation pending`, String(payout.telegram_id), `%spin #${payout.spin_number};%`]
    });
    return { ...payout, status: "submitted", payout_query_id: queryId, wallet_address: destination.toString(), submitted_at: stamp };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    await db.execute({
      sql: `UPDATE spin_ton_payouts SET status = 'review_required', error_message = ? WHERE spin_history_id = ? AND status = 'submitting'`,
      args: [message, Number(spinHistoryId)]
    });
    await db.execute({
      sql: `UPDATE transactions SET status = 'Review Required', details = ? WHERE telegram_id = ? AND type = 'SPIN_TON' AND details LIKE ?`,
      args: [`0.1 TON payout send outcome needs manual verification; no automatic retry. Error: ${message}`, String(payout.telegram_id), `%spin #${payout.spin_number};%`]
    });
    return { ...payout, status: "review_required", error_message: message };
  }
}

// ============================================================
// DAILY SPIN
// ============================================================
app.get("/api/spin/status", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const id = String(verified.id);
    const freeResult = await db.execute({ sql: `SELECT claimed_at FROM spin_free_claims WHERE telegram_id = ? LIMIT 1`, args: [id] });
    const lastFree = freeResult.rows[0]?.claimed_at ? new Date(freeResult.rows[0].claimed_at).getTime() : 0;
    const nowMs = Date.now();
    const freeReady = !lastFree || !Number.isFinite(lastFree) || nowMs - lastFree >= 24 * 60 * 60 * 1000;
    const ticketsResult = await db.execute({ sql: `SELECT COUNT(*) AS n FROM spin_tickets WHERE owner_telegram_id = ? AND used_at IS NULL`, args: [id] });
    const countResult = await db.execute({ sql: `SELECT COUNT(*) AS n FROM spin_history WHERE telegram_id = ?`, args: [id] });
    const pendingTon = await db.execute({ sql: `SELECT COUNT(*) AS n FROM spin_history WHERE telegram_id = ? AND prize_type = 'TON' AND reward > 0`, args: [id] });
    res.json({ ok: true, free_ready: freeReady, next_free_at: freeReady ? null : new Date(lastFree + 86400000).toISOString(), tickets: Number(ticketsResult.rows[0]?.n || 0), spin_count: Number(countResult.rows[0]?.n || 0), ton_wins: Number(pendingTon.rows[0]?.n || 0) });
  } catch (error) {
    console.error("/api/spin/status", error);
    res.status(500).json({ error: "Spin status unavailable" });
  }
});

app.post("/api/spin/claim", async (req, res) => {
  let tx;
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const id = String(verified.id);
    const stamp = now();
    tx = await db.transaction("write");
    const freeResult = await tx.execute({ sql: `SELECT claimed_at FROM spin_free_claims WHERE telegram_id = ? LIMIT 1`, args: [id] });
    const lastFree = freeResult.rows[0]?.claimed_at ? new Date(freeResult.rows[0].claimed_at).getTime() : 0;
    const freeReady = !lastFree || !Number.isFinite(lastFree) || Date.now() - lastFree >= 86400000;
    let ticket = null;
    let spinKind = "free";
    if (!freeReady) {
      const ticketResult = await tx.execute({ sql: `SELECT id FROM spin_tickets WHERE owner_telegram_id = ? AND used_at IS NULL ORDER BY id LIMIT 1`, args: [id] });
      ticket = ticketResult.rows[0] || null;
      if (!ticket) { await tx.rollback(); tx = null; return res.status(409).json({ error: "Free spin is available every 24 hours. Invite a new friend who opens the mini app and connects a TON wallet to earn an extra ticket.", free_ready: false }); }
      spinKind = "ticket";
      const used = await tx.execute({ sql: `UPDATE spin_tickets SET used_at = ? WHERE id = ? AND used_at IS NULL`, args: [stamp, Number(ticket.id)] });
      if (Number(used.rowsAffected || 0) !== 1) throw new Error("Spin ticket already used");
    } else {
      await tx.execute({ sql: `INSERT INTO spin_free_claims (telegram_id, claimed_at) VALUES (?, ?) ON CONFLICT(telegram_id) DO UPDATE SET claimed_at = excluded.claimed_at`, args: [id, stamp] });
    }
    const countResult = await tx.execute({ sql: `SELECT COUNT(*) AS n FROM spin_history WHERE telegram_id = ?`, args: [id] });
    const spinNumber = Number(countResult.rows[0]?.n || 0) + 1;
    let prizeType = "NONE", reward = 0, prizeIndex = 7;
    const jackpot = spinNumber >= 10 && crypto.randomInt(100) === 0;
    if (jackpot) {
      prizeType = "TON";
      reward = 0.1;
      prizeIndex = 6;
    } else {
      const normalSlots = [0, 1, 2, 3, 4, 5, 7, 8];
      prizeIndex = normalSlots[crypto.randomInt(normalSlots.length)];
      const rewards = { 0: 1, 1: 2.5, 2: 5, 3: 10, 4: 25, 5: 50, 7: 0, 8: 0 };
      reward = rewards[prizeIndex];
      prizeType = reward > 0 ? "SNP" : "NONE";
    }
    const spinInsert = await tx.execute({ sql: `INSERT INTO spin_history (telegram_id, spin_number, ticket_id, spin_kind, prize_type, reward, prize_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, spinNumber, ticket ? Number(ticket.id) : null, spinKind, prizeType, reward, prizeIndex, stamp] });
    const spinHistoryId = Number(spinInsert.lastInsertRowid);
    if (prizeType === "SNP" && reward > 0) {
      const credited = await tx.execute({ sql: `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`, args: [reward, id] });
      if (Number(credited.rowsAffected || 0) !== 1) throw new Error("Could not credit spin reward");
      await tx.execute({ sql: `INSERT INTO transactions (telegram_id, type, amount, status, details, created_at) VALUES (?, 'SPIN', ?, 'Completed', ?, ?)`, args: [id, reward, `Spin #${spinNumber} ${spinKind} reward`, stamp] });
    } else if (prizeType === "TON") {
      const spinUser = await tx.execute({ sql: `SELECT wallet_address FROM users WHERE telegram_id = ? LIMIT 1`, args: [id] });
      const walletAddress = String(spinUser.rows[0]?.wallet_address || "").trim() || null;
      await tx.execute({ sql: `INSERT INTO transactions (telegram_id, type, amount, status, details, created_at) VALUES (?, 'SPIN_TON', 0, 'Pending', ?, ?)`, args: [`${id}`, `0.1 TON jackpot won on spin #${spinNumber}; automatic payout queued`, stamp] });
      await tx.execute({ sql: `INSERT INTO spin_ton_payouts (spin_history_id, telegram_id, wallet_address, amount_ton, status, created_at) VALUES (?, ?, ?, '0.1', 'pending', ?)`, args: [spinHistoryId, id, walletAddress, stamp] });
    } else {
      await tx.execute({ sql: `INSERT INTO transactions (telegram_id, type, amount, status, details, created_at) VALUES (?, 'SPIN', 0, 'Completed', ?, ?)`, args: [id, `No prize on spin #${spinNumber}`, stamp] });
    }
    await tx.commit(); tx = null;
    let tonPayout = null;
    if (prizeType === "TON") {
      try {
        tonPayout = await submitSpinTonPayout(spinHistoryId);
      } catch (payoutError) {
        tonPayout = { status: "pending" };
      }
    }
    const user = await getUser(id);
    res.json({ ok: true, reward, prize_type: prizeType, prize_index: prizeIndex, spin_number: spinNumber, spin_kind: spinKind, tickets_used: spinKind === "ticket", free_ready: false, ton_payout_status: tonPayout?.status || null, ton_payout_message: prizeType === "TON" ? (tonPayout?.status === "submitted" ? "TON payout submitted; blockchain confirmation is pending." : tonPayout?.status === "wallet_required" ? "Connect a TON wallet to receive this prize." : tonPayout?.status === "review_required" ? "Payout requires treasury review; do not retry automatically." : "TON payout is pending.") : null, user: publicUser(user) });
  } catch (error) {
    try { if (tx) await tx.rollback(); } catch (_) {}
    console.error("/api/spin/claim", error);
    res.status(500).json({ error: "Spin could not be completed" });
  }
});

app.post("/api/spin/ton-payout/claim", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const id = String(verified.id);
    const latest = await db.execute({
      sql: `SELECT p.spin_history_id, p.status FROM spin_ton_payouts p WHERE p.telegram_id = ? AND p.status IN ('pending','wallet_required') ORDER BY p.id DESC LIMIT 1`,
      args: [id]
    });
    if (!latest.rows[0]) return res.status(404).json({ error: "No eligible unpaid TON spin prize found." });
    const user = await getUser(id);
    const wallet = String(user?.wallet_address || "").trim();
    if (!wallet) return res.status(400).json({ error: "Connect your TON wallet first." });
    await db.execute({ sql: `UPDATE spin_ton_payouts SET wallet_address = ?, status = 'pending', error_message = NULL WHERE spin_history_id = ? AND status IN ('pending','wallet_required')`, args: [wallet, Number(latest.rows[0].spin_history_id)] });
    const payout = await submitSpinTonPayout(Number(latest.rows[0].spin_history_id));
    return res.json({ ok: true, status: payout.status, message: payout.status === "submitted" ? "TON payout submitted; blockchain confirmation is pending." : "Payout status: " + payout.status });
  } catch (error) {
    console.error("/api/spin/ton-payout/claim", error);
    return res.status(500).json({ error: "TON prize payout could not be submitted." });
  }
});


// ============================================================
// REQUIRED TELEGRAM JOIN GATE
// ============================================================
app.post("/api/onboarding/verify", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const destinations = [
      { id: "channel", chat: "@SINAPS_COIN" },
      { id: "withdrawals", chat: "@SINAPS_Withdrawals" },
      { id: "group", chat: "@SINAPS_Group" }
    ];
    const results = await Promise.all(destinations.map(async item => ({
      id: item.id,
      joined: await isTelegramMember(item.chat, String(verified.id))
    })));
    const allJoined = results.every(item => item.joined);
    return res.json({ ok: true, verified: allJoined, memberships: results });
  } catch (error) {
    console.error("/api/onboarding/verify", error);
    return res.status(500).json({ error: "Could not verify Telegram memberships. Please try again." });
  }
});

// ============================================================
// GET TASKS
// ============================================================

app.get(
  "/api/tasks",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }


      const tasks =
        await getTaskStatus(
          verified.id
        );


      res.json({

        ok:
          true,

        tasks

      });

    } catch (error) {

      console.error(
        "/api/tasks",
        error
      );

      res.status(500).json({

        error:
          "Tasks could not be loaded",

        details:
          error.message

      });
    }
  }
);


// ============================================================
// SINAPS ADVERTISING API
// ============================================================

const AD_PRICE_PER_CLICK = 0.001;
const AD_MIN_CLICKS = 100;
const AD_MAX_CLICKS = 100000;

function calculateAdPrice(clicks) {
  return Number((Number(clicks) * AD_PRICE_PER_CLICK).toFixed(6));
}

function parsePublicTelegramChat(targetUrl) {
  let parsed;
  try { parsed = new URL(String(targetUrl || "")); } catch (_) { return null; }
  if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(parsed.hostname.toLowerCase())) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!parts.length || ['joinchat', 'addstickers', 'share', 'proxy', 's'].includes(parts[0].toLowerCase())) return null;
  const username = parts[0].replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  return `@${username}`;
}

async function checkSinapsBotAdmin(platform, targetUrl) {
  const chat = parsePublicTelegramChat(targetUrl);
  if (!chat) return { ok: false, error: "Use a public Telegram channel/group link such as https://t.me/yourchannel. Private invite links cannot be verified." };
  const me = await telegramApi("getMe", {});
  if (!me || !me.id) return { ok: false, error: "Telegram bot API is unavailable. Try again later." };
  const chatInfo = await telegramApi("getChat", { chat_id: chat });
  if (!chatInfo || !chatInfo.id) return { ok: false, error: "Telegram could not find this public channel/group. Check the link and make sure the bot has been added." };
  const member = await telegramApi("getChatMember", { chat_id: chatInfo.id, user_id: me.id });
  if (!member || !["administrator", "creator"].includes(String(member.status || "").toLowerCase())) {
    return { ok: false, error: "SINAPS bot is not an administrator of this channel/group. Add the bot as admin and check again." };
  }
  return { ok: true, is_admin: true, chat_id: String(chatInfo.id), title: String(chatInfo.title || chat) };
}

app.post("/api/ads/check-telegram-admin", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const platform = String(req.body?.platform || "").toLowerCase();
    if (!["channel", "group", "telegram"].includes(platform)) {
      return res.json({ ok: true, is_admin: true, not_required: true });
    }
    const result = await checkSinapsBotAdmin(platform, req.body?.target_url);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    console.error("/api/ads/check-telegram-admin:", error);
    return res.status(500).json({ ok: false, is_admin: false, error: "Could not verify Telegram bot administrator status." });
  }
});

app.post("/api/ads/create", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;

    const telegramId = String(verified.id);

    const {
      title,
      description,
      platform,
      target_url,
      target_clicks
    } = req.body || {};

    const cleanTitle = String(title || "").trim();
    const cleanDescription = String(description || "").trim();
    const cleanPlatform = String(platform || "").trim().toLowerCase();
    const cleanUrl = String(target_url || "").trim();
    const clicks = Number(target_clicks);

    const allowedPlatforms = [
      "telegram",
      "channel",
      "group",
      "bot",
      "website",
      "youtube",
      "instagram",
      "x",
      "other"
    ];

    if (
      cleanTitle.length < 3 ||
      cleanTitle.length > 100
    ) {
      return res.status(400).json({
        ok: false,
        error: "عنوان تبلیغ باید بین ۳ تا ۱۰۰ کاراکتر باشد."
      });
    }

    if (cleanDescription.length > 1000) {
      return res.status(400).json({
        ok: false,
        error: "توضیحات تبلیغ بیش از حد طولانی است."
      });
    }

    if (!allowedPlatforms.includes(cleanPlatform)) {
      return res.status(400).json({
        ok: false,
        error: "پلتفرم تبلیغ معتبر نیست."
      });
    }

    if (["channel", "group", "telegram"].includes(cleanPlatform)) {
      const adminCheck = await checkSinapsBotAdmin(cleanPlatform, cleanUrl);
      if (!adminCheck.ok) {
        return res.status(400).json({ ok: false, error: adminCheck.error, bot_admin_required: true });
      }
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(cleanUrl);
    } catch (_) {
      return res.status(400).json({
        ok: false,
        error: "لینک تبلیغ معتبر نیست."
      });
    }

    if (
      !["https:", "http:"].includes(parsedUrl.protocol) ||
      !parsedUrl.hostname.includes(".") ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      return res.status(400).json({
        ok: false,
        error: "لینک باید یک آدرس HTTP یا HTTPS معتبر باشد."
      });
    }

    if (
      !Number.isInteger(clicks) ||
      clicks < AD_MIN_CLICKS ||
      clicks > AD_MAX_CLICKS
    ) {
      return res.status(400).json({
        ok: false,
        error: `تعداد کلیک باید بین ${AD_MIN_CLICKS} و ${AD_MAX_CLICKS} باشد.`
      });
    }

    const price = calculateAdPrice(clicks);
    const now = new Date().toISOString();

    const result = await db.execute({
      sql: `
        INSERT INTO ad_tasks (
          telegram_id,
          title,
          description,
          platform,
          target_url,
          target_clicks,
          valid_clicks,
          price_gram,
          reward_per_user,
          budget_snp,
          status,
          payment_verified,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 100, 0,
                'pending_payment', 0, ?, ?)
      `,
      args: [
        telegramId,
        cleanTitle,
        cleanDescription,
        cleanPlatform,
        cleanUrl,
        clicks,
        price,
        now,
        now
      ]
    });

    return res.json({
      ok: true,
      message: "تبلیغ ثبت شد؛ منتظر پرداخت و بررسی است.",
      ad: {
        id: Number(result.lastInsertRowid),
        title: cleanTitle,
        platform: cleanPlatform,
        target_clicks: clicks,
        price_gram: price,
        status: "pending_payment"
      }
    });
  } catch (error) {
    console.error("/api/ads/create:", error);

    return res.status(500).json({
      ok: false,
      error: "ثبت تبلیغ انجام نشد."
    });
  }
});


app.get("/api/ads/my", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;

    const result = await db.execute({
      sql: `
        SELECT
          id,
          title,
          description,
          platform,
          target_url,
          target_clicks,
          valid_clicks,
          price_gram,
          status,
          payment_verified,
          created_at
        FROM ad_tasks
        WHERE telegram_id = ?
          AND LOWER(status) NOT IN ('cancelled', 'canceled')
        ORDER BY id DESC
        LIMIT 100
      `,
      args: [String(verified.id)]
    });

    return res.json({
      ok: true,
      ads: result.rows
    });
  } catch (error) {
    console.error("/api/ads/my:", error);

    return res.status(500).json({
      ok: false,
      error: "تبلیغات شما بارگذاری نشد."
    });
  }
});


app.post("/api/ads/click", async (req, res) => {
  let tx;
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const telegramId = String(verified.id);
    const rawId = String(req.body?.task_id || "").trim();
    const adId = Number(rawId.startsWith("ad:") ? rawId.slice(3) : rawId);
    if (!Number.isSafeInteger(adId) || adId <= 0) {
      return res.status(400).json({ error: "Invalid advertising task." });
    }

    tx = await db.transaction("write");
    const found = await tx.execute({
      sql: `SELECT * FROM ad_tasks WHERE id = ? AND status = 'active' AND payment_verified = 1 AND valid_clicks < target_clicks LIMIT 1`,
      args: [adId]
    });
    const ad = found.rows[0];
    if (!ad) {
      await tx.rollback(); tx = null;
      return res.status(404).json({ error: "This ad is no longer active." });
    }
    if (String(ad.telegram_id) === telegramId) {
      await tx.rollback(); tx = null;
      return res.status(403).json({ error: "You cannot click your own advertisement." });
    }

    // Allow one reward per user per ad every 24 hours. The unique row is reused
    // after cooldown; main/static tasks are not affected.
    const claimTime = now();
    const claim = await tx.execute({
      sql: `INSERT INTO ad_task_clicks (task_id, telegram_id, clicked_at, status, reviewed_at, reward_paid)
            VALUES (?, ?, ?, 'completed', ?, 1)
            ON CONFLICT(task_id, telegram_id) DO UPDATE SET
              clicked_at = excluded.clicked_at, status = 'completed', reviewed_at = excluded.reviewed_at, reward_paid = 1
            WHERE datetime(ad_task_clicks.clicked_at) <= datetime('now', '-24 hours')`,
      args: [adId, telegramId, claimTime, claimTime]
    });
    if (Number(claim.rowsAffected || 0) !== 1) {
      await tx.rollback(); tx = null;
      const existingUser = await getUser(telegramId);
      const previous = await db.execute({sql:`SELECT clicked_at FROM ad_task_clicks WHERE task_id = ? AND telegram_id = ? LIMIT 1`, args:[adId, telegramId]});
      const last = previous.rows[0]?.clicked_at ? new Date(String(previous.rows[0].clicked_at)).getTime() : Date.now();
      const remaining = Math.max(0, Math.ceil((last + 86400000 - Date.now()) / 1000));
      return res.status(429).json({ok:false, cooldown_seconds:remaining, balance:Number(existingUser?.balance || 0), error:"This ad will be available again when the 24-hour timer ends."});
    }

    const advanced = await tx.execute({
      sql: `UPDATE ad_tasks SET valid_clicks = valid_clicks + 1, status = CASE WHEN valid_clicks + 1 >= target_clicks THEN 'completed' ELSE status END, updated_at = ? WHERE id = ? AND status = 'active' AND valid_clicks < target_clicks`,
      args: [now(), adId]
    });
    if (Number(advanced.rowsAffected || 0) !== 1) throw new Error("This ad has reached its target.");

    await tx.execute({
      sql: `INSERT INTO ad_link_clicks (task_id, telegram_id, clicked_at) VALUES (?, ?, ?) ON CONFLICT(task_id, telegram_id) DO NOTHING`,
      args: [adId, telegramId, now()]
    });
    const reward = Number(ad.reward_per_user || 10) || 10;
    const credit = await tx.execute({
      sql: `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`,
      args: [reward, telegramId]
    });
    if (Number(credit.rowsAffected || 0) !== 1) throw new Error("Could not credit advertising task reward.");
    await tx.execute({
      sql: `INSERT INTO transactions (telegram_id, type, amount, status, details, created_at) VALUES (?, 'TASK', ?, 'Completed', ?, ?)`,
      args: [telegramId, reward, `Advertising link click reward: ${String(ad.title || ad.id)}`, now()]
    });
    await tx.commit(); tx = null;

    const fresh = await getUser(telegramId);
    const count = await db.execute({sql:`SELECT COUNT(*) AS click_count FROM ad_link_clicks WHERE task_id = ?`, args:[adId]});
    return res.json({ok:true, reward, balance:Number(fresh?.balance || 0), click_count:Number(count.rows[0]?.click_count || 0), completed:true});
  } catch (error) {
    try { if (tx) await tx.rollback(); } catch (_) {}
    console.error("/api/ads/click:", error);
    return res.status(500).json({ error: "Could not record the ad click and reward." });
  }
});

app.get("/api/ads/active", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;

    const result = await db.execute({
      sql: `
        SELECT
          id,
          title,
          description,
          platform,
          target_url,
          target_clicks,
          valid_clicks,
          reward_per_user,
          created_at,
          (SELECT COUNT(*) FROM ad_link_clicks lc WHERE lc.task_id = ad_tasks.id) AS click_count
        FROM ad_tasks
        WHERE status = 'active'
          AND payment_verified = 1
          AND valid_clicks < target_clicks
        ORDER BY id DESC
        LIMIT 100
      `,
      args: []
    });

    return res.json({
      ok: true,
      ads: result.rows
    });
  } catch (error) {
    console.error("/api/ads/active:", error);

    return res.status(500).json({
      ok: false,
      error: "Failed to load active ads."
    });
  }
});
// Return exact payment details for an owned unpaid ad.
app.post("/api/ads/payment-details", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const adId = Number(req.body?.ad_id);
    if (!Number.isSafeInteger(adId) || adId <= 0) return res.status(400).json({ ok: false, error: "Invalid ad ID." });
    const result = await db.execute({
      sql: `SELECT id, price_gram, status, payment_verified FROM ad_tasks WHERE id = ? AND telegram_id = ? LIMIT 1`,
      args: [adId, String(verified.id)]
    });
    const ad = result.rows[0];
    if (!ad) return res.status(404).json({ ok: false, error: "Advertisement not found." });
    if (ad.status !== "pending_payment" || Number(ad.payment_verified) === 1) {
      return res.status(409).json({ ok: false, error: "This ad is not awaiting payment." });
    }
    if (!TREASURY_WALLET) return res.status(500).json({ ok: false, error: "Payment destination is not configured." });
    const amountNano = String(Math.round(Number(ad.price_gram) * 1_000_000_000));
    return res.json({ ok: true, ad_id: adId, treasury_wallet: TREASURY_WALLET, amount_nano: amountNano, price_gram: Number(ad.price_gram) });
  } catch (error) {
    console.error("/api/ads/payment-details:", error);
    return res.status(500).json({ ok: false, error: "Could not prepare ad payment." });
  }
});

app.post("/api/ads/cancel", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;
    const adId = Number(req.body?.ad_id);
    if (!Number.isSafeInteger(adId) || adId <= 0) return res.status(400).json({ ok: false, error: "Invalid ad ID." });
    const result = await db.execute({
      sql: `UPDATE ad_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND telegram_id = ? AND status = 'pending_payment' AND payment_verified = 0`,
      args: [now(), adId, String(verified.id)]
    });
    if (Number(result.rowsAffected || 0) !== 1) {
      return res.status(409).json({ ok: false, error: "Only unpaid ads can be cancelled. Reload My Ads and check the status." });
    }
    return res.json({ ok: true, ad_id: adId, status: "cancelled" });
  } catch (error) {
    console.error("/api/ads/cancel:", error);
    return res.status(500).json({ ok: false, error: "Could not cancel advertisement." });
  }
});

// Live SNP market pair and price, sourced from DexScreener.
app.get("/api/snp/market", async (req, res) => {
  try {
    const address = encodeURIComponent(String(SNP_CONTRACT || "").trim());
    if (!address) return res.json({ ok: true, available: false });
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/ton/${address}`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return res.status(502).json({ ok: false, available: false, error: "Market provider unavailable." });
    const payload = await response.json();
    const pairs = Array.isArray(payload) ? payload : [];
    const active = pairs.filter(pair => Number(pair?.liquidity?.usd || 0) > 0 && pair?.pairAddress)
      .sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
    const pair = active[0];
    if (!pair) return res.json({ ok: true, available: false, token_address: SNP_CONTRACT });
    return res.json({
      ok: true,
      available: true,
      token_address: SNP_CONTRACT,
      pair_address: pair.pairAddress,
      pair_url: pair.url || `https://dexscreener.com/ton/${pair.pairAddress}`,
      price_usd: pair.priceUsd || null,
      price_native: pair.priceNative || null,
      change_24h: Number(pair?.priceChange?.h24 || 0),
      liquidity_usd: Number(pair?.liquidity?.usd || 0),
      volume_24h: Number(pair?.volume?.h24 || 0)
    });
  } catch (error) {
    console.error("/api/snp/market:", error);
    return res.status(502).json({ ok: false, available: false, error: "Could not load live SNP market data." });
  }
});

// ============================================================
// VERIFY AD PAYMENT
// ============================================================

app.post("/api/ads/verify-payment", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;

    const telegramId = String(verified.id);
    const adId = Number(req.body?.ad_id);

    if (!Number.isSafeInteger(adId) || adId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid ad ID."
      });
    }

    const result = await db.execute({
      sql: `
        SELECT *
        FROM ad_tasks
        WHERE id = ?
          AND telegram_id = ?
        LIMIT 1
      `,
      args: [adId, telegramId]
    });

    const ad = result.rows[0];

    if (!ad) {
      return res.status(404).json({
        ok: false,
        error: "Advertisement not found."
      });
    }

    if (
      Number(ad.payment_verified) === 1 &&
      ad.status === "active"
    ) {
      return res.json({
        ok: true,
        message: "Payment has already been verified.",
        ad
      });
    }

    if (ad.status !== "pending_payment") {
      return res.status(409).json({
        ok: false,
        error: "This advertisement is not awaiting payment."
      });
    }

    // Payment verification requires the buyer's wallet address.
    const walletResult = await db.execute({
      sql: `
        SELECT wallet_address
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,
      args: [telegramId]
    });

    const buyerWallet = String(
      walletResult.rows[0]?.wallet_address || ""
    ).trim();

    if (!buyerWallet) {
      return res.status(400).json({
        ok: false,
        error: "Connect your TON wallet before verifying payment."
      });
    }

    const destination = String(TREASURY_WALLET || "").trim();

    if (!destination) {
      return res.status(500).json({
        ok: false,
        error: "Payment destination is not configured."
      });
    }

    const headers = TONCENTER_API_KEY
      ? { "X-API-Key": TONCENTER_API_KEY }
      : {};

    const treasuryRaw = Address.parse(destination).toRawString();
    const buyerRaw = Address.parse(buyerWallet).toRawString();

    const expectedNano = BigInt(
      Math.round(Number(ad.price_gram) * 1_000_000_000)
    );

    if (expectedNano <= 0n) {
      return res.status(400).json({
        ok: false,
        error: "Invalid advertisement payment amount."
      });
    }

    const url =
      `${TONCENTER}/transactions` +
      `?account=${encodeURIComponent(treasuryRaw)}` +
      `&limit=100`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return res.status(503).json({
        ok: false,
        error: "Unable to check the blockchain right now. Please try again."
      });
    }

    const data = await response.json();

    const transactions = Array.isArray(data)
      ? data
      : (data.transactions || data.result || []);

    if (!Array.isArray(transactions)) {
      return res.status(503).json({
        ok: false,
        error: "Unexpected blockchain response. Please try again."
      });
    }

    let matchedTx = null;

    for (const tx of transactions) {
      try {
        const inMsg =
          tx.in_msg ||
          tx.inMessage ||
          tx.in_message ||
          null;

        if (!inMsg) continue;

        const value = BigInt(
          String(
            inMsg.value ??
            inMsg.amount ??
            inMsg.coins ??
            "0"
          )
        );

        if (value !== expectedNano) continue;

        const sender = String(
          inMsg.source ||
          inMsg.src ||
          inMsg.sender ||
          ""
        ).trim();

        if (!sender) continue;

        if (Address.parse(sender).toRawString() !== buyerRaw) {
          continue;
        }

        const txHash = String(
          tx.hash ||
          tx.transaction_hash ||
          tx.tx_hash ||
          tx.id ||
          ""
        );

        if (!txHash) continue;

        matchedTx = {
          hash: txHash,
          value: value.toString()
        };

        break;
      } catch (_) {
        // Ignore transactions that cannot be parsed.
      }
    }

    if (!matchedTx) {
      return res.status(400).json({
        ok: false,
        error: "Payment has not been found yet. Please wait and try again.",
        status: "pending_payment"
      });
    }

    // Store verified payment and activate the ad atomically.
    const update = await db.execute({
      sql: `
        UPDATE ad_tasks
        SET
          payment_verified = 1,
          status = 'active',
          updated_at = ?
        WHERE id = ?
          AND telegram_id = ?
          AND status = 'pending_payment'
          AND payment_verified = 0
      `,
      args: [now(), adId, telegramId]
    });

    if (!update.rowsAffected) {
      const latest = await db.execute({
        sql: `
          SELECT id, status, payment_verified
          FROM ad_tasks
          WHERE id = ? AND telegram_id = ?
          LIMIT 1
        `,
        args: [adId, telegramId]
      });

      if (Number(latest.rows[0]?.payment_verified) === 1) {
        return res.json({
          ok: true,
          message: "Payment has already been verified.",
          ad: latest.rows[0]
        });
      }

      return res.status(409).json({
        ok: false,
        error: "Advertisement status changed. Please reload and try again."
      });
    }

    return res.json({
      ok: true,
      message: "Payment verified. Your advertisement is now active.",
      ad_id: adId,
      status: "active",
      transaction_hash: matchedTx.hash
    });
  } catch (error) {
    console.error("/api/ads/verify-payment:", error);

    return res.status(500).json({
      ok: false,
      error: "Advertisement payment verification failed."
    });
  }
});

// ============================================================
// SNP HOLDER CHECK
// ============================================================

async function checkSnpBalance(
  wallet
) {

  if (!wallet) {
    return false;
  }

  try {

    const headers =
      TONCENTER_API_KEY
        ? {
            "X-API-Key":
              TONCENTER_API_KEY
          }
        : {};


    const ownerAddress =
      Address.parse(
        String(wallet).trim()
      ).toString();


    const jettonMasterAddress =
      Address.parse(
        SNP_CONTRACT
      ).toString();


    const url =
      `${TONCENTER}/jetton/wallets` +
      `?owner_address=${encodeURIComponent(ownerAddress)}` +
      `&jetton_address=${encodeURIComponent(jettonMasterAddress)}` +
      `&limit=10`;


    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers
        }
      );


    if (!response.ok) {

      const errorText =
        await response.text()
          .catch(
            () => ""
          );

      throw new Error(
        `Unable to verify SNP balance: ${response.status} ${errorText}`
      );
    }


    const data =
      await response.json();


    const wallets =
      Array.isArray(
        data?.jetton_wallets
      )
        ? data.jetton_wallets
        : [];


    if (!wallets.length) {
      return false;
    }


    const targetMaster =
      normalizeAddress(
        SNP_CONTRACT
      );


    const row =
      wallets.find(
        item => {

          try {

            return normalizeAddress(
              String(
                item?.jetton ||
                item?.jetton_master ||
                ""
              )
            ) === targetMaster;

          } catch {

            return false;
          }
        }
      ) ||
      wallets[0];


    const rawBalance =
      BigInt(
        String(
          row?.balance ||
          "0"
        )
      );


    const requiredRaw =
      BigInt(
        HOLDER_MIN_SNP
      ) *
      1000000000n;


    return (
      rawBalance >=
      requiredRaw
    );

  } catch (error) {

    console.error(
      "checkSnpBalance:",
      error
    );

    throw error;
  }
}


// ============================================================
// TASK CLAIM
// ============================================================

app.post(
  "/api/tasks/claim",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }


      const telegramId =
        String(verified.id);


      const taskId =
        String(
          req.body.task_id ||
          ""
        ).trim();


      const requestedWallet =
        String(
          req.body.wallet_address ||
          ""
        ).trim();


      const recurringTaskIds = new Set(["channel", "group", "withdrawals_channel", "twitter", "like_retweet"]);
      if (recurringTaskIds.has(taskId)) {
        const task = TASKS.find(item => String(item.id) === taskId);
        if (!task) return res.status(400).json({ error: "Unknown task" });
        const lastResult = await db.execute({
          sql: `SELECT created_at FROM recurring_task_claims WHERE telegram_id = ? AND task_id = ? ORDER BY id DESC LIMIT 1`,
          args: [telegramId, taskId]
        });
        const lastStamp = lastResult.rows[0]?.created_at ? new Date(String(lastResult.rows[0].created_at)).getTime() : 0;
        const remaining = lastStamp ? Math.ceil((lastStamp + 86400000 - Date.now()) / 1000) : 0;
        if (remaining > 0) return res.status(429).json({ error: `Available again in ${Math.ceil(remaining / 3600)}h ${Math.ceil((remaining % 3600) / 60)}m`, cooldown_seconds: remaining });
        if (task.type === "telegram") {
          const member = await isTelegramMember(task.chat, telegramId);
          if (!member) return res.status(400).json({ error: "Join the Telegram channel/group first, then verify. The SINAPS bot must be an administrator to check membership." });
        }
        const reward = Math.max(0, safeInt(task.reward, 0));
        let tx;
        try {
          tx = await db.transaction("write");
          const stamp = now();
          await tx.execute({ sql: `INSERT INTO recurring_task_claims (telegram_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)`, args: [telegramId, taskId, reward, stamp] });
          const credit = await tx.execute({ sql: `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`, args: [reward, telegramId] });
          if (Number(credit.rowsAffected || 0) !== 1) throw new Error("Could not credit task reward");
          await tx.execute({ sql: `INSERT INTO transactions (telegram_id, type, amount, status, details, created_at) VALUES (?, 'TASK', ?, 'Completed', ?, ?)`, args: [telegramId, reward, `${task.name || task.id} (24h repeat)`, stamp] });
          await tx.commit();
        } catch (claimError) {
          try { if (tx) await tx.rollback(); } catch (_) {}
          throw claimError;
        }
        const fresh = await getUser(telegramId);
        return res.json({ ok: true, task_id: taskId, reward, balance: Number(fresh?.balance || 0), cooldown_seconds: 86400 });
      }

      if (taskId.startsWith("ad:")) {
        const adId = Number(taskId.slice(3));
        if (!Number.isSafeInteger(adId) || adId <= 0) {
          return res.status(400).json({ error: "Invalid advertising task" });
        }
        const adResult = await db.execute({
          sql: `SELECT * FROM ad_tasks WHERE id = ? AND status = 'active' AND payment_verified = 1 AND valid_clicks < target_clicks LIMIT 1`,
          args: [adId]
        });
        const ad = adResult.rows[0];
        if (!ad) return res.status(404).json({ error: "This advertising task is no longer available." });
        if (String(ad.telegram_id) === telegramId) return res.status(403).json({ error: "You cannot complete your own advertisement." });
        const platform = String(ad.platform || "").toLowerCase();
        if (!["telegram", "channel", "group"].includes(platform)) {
          return res.status(400).json({ error: "Automatic completion verification is currently available for Telegram channels and groups only." });
        }
        let chat = "";
        try {
          const parsed = new URL(String(ad.target_url || ""));
          if (!/(^|\.)t\.me$/i.test(parsed.hostname)) throw new Error("Not a Telegram link");
          const segments = parsed.pathname.split("/").filter(Boolean);
          if (!segments.length || ["joinchat", "c", "+"].includes(segments[0])) throw new Error("Private invite links cannot be verified automatically");
          chat = "@" + segments[0].replace(/^@/, "");
        } catch (_) {
          return res.status(400).json({ error: "Use a public Telegram channel/group link so SINAPS can verify membership." });
        }
        const member = await isTelegramMember(chat, telegramId);
        if (!member) return res.status(400).json({ error: "Join the Telegram channel/group first. The SINAPS bot must be an administrator to verify membership." });
        const reward = 100;
        let tx;
        try {
          tx = await db.transaction("write");
          const claimTime = now();
          const claim = await tx.execute({
            sql: `INSERT INTO ad_task_clicks (task_id, telegram_id, clicked_at, status, reviewed_at, reward_paid)
                  VALUES (?, ?, ?, 'completed', ?, 1)
                  ON CONFLICT(task_id, telegram_id) DO UPDATE SET
                    clicked_at = excluded.clicked_at, status = 'completed', reviewed_at = excluded.reviewed_at, reward_paid = 1
                  WHERE datetime(ad_task_clicks.clicked_at) <= datetime('now', '-24 hours')`,
            args: [adId, telegramId, claimTime, claimTime]
          });
          if (Number(claim.rowsAffected || 0) !== 1) {
            const previous = await tx.execute({sql:`SELECT clicked_at FROM ad_task_clicks WHERE task_id = ? AND telegram_id = ? LIMIT 1`, args:[adId, telegramId]});
            const last = previous.rows[0]?.clicked_at ? new Date(String(previous.rows[0].clicked_at)).getTime() : Date.now();
            const remaining = Math.max(0, Math.ceil((last + 86400000 - Date.now()) / 1000));
            throw new Error(`This ad is on cooldown for ${remaining} more seconds.`);
          }
          await tx.execute({
            sql: `UPDATE ad_tasks SET valid_clicks = valid_clicks + 1, status = CASE WHEN valid_clicks + 1 >= target_clicks THEN 'completed' ELSE status END, updated_at = ? WHERE id = ? AND status = 'active' AND valid_clicks < target_clicks`,
            args: [now(), adId]
          });
          const credit = await tx.execute({
            sql: `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`,
            args: [reward, telegramId]
          });
          if (Number(credit.rowsAffected || 0) !== 1) throw new Error("Could not credit advertising task reward");
          await tx.execute({
            sql: `INSERT INTO transactions (telegram_id, type, amount, status, details, created_at) VALUES (?, 'TASK', ?, 'Completed', ?, ?)`,
            args: [telegramId, reward, `Advertising task: ${String(ad.title || ad.id)}`, now()]
          });
          await tx.commit();
        } catch (claimError) {
          try { if (tx) await tx.rollback(); } catch (_) {}
          if (String(claimError.message || "").toLowerCase().includes("unique")) return res.status(400).json({ error: "You have already completed this advertising task.", already_completed: true });
          throw claimError;
        }
        const fresh = await getUser(telegramId);
        return res.json({ ok: true, task_id: taskId, reward, balance: Number(fresh?.balance || 0) });
      }

      const task = TASKS.find(item => String(item.id) === taskId);

      if (!task) {

        return res.status(400)
          .json({
            error:
              "Unknown task"
          });
      }


      const user =
        await getUser(
          telegramId
        );


      if (!user) {

        return res.status(404)
          .json({
            error:
              "User not found"
          });
      }


      const already =
        await db.execute({

          sql: `
            SELECT id
            FROM task_claims
            WHERE telegram_id = ?
              AND task_id = ?
            LIMIT 1
          `,

          args: [
            telegramId,
            taskId
          ]
        });


      if (
        already.rows.length
      ) {

        return res.status(400)
          .json({

            error:
              "Task already completed",

            already_completed:
              true

          });
      }


      if (
        task.type ===
        "referral"
      ) {

        const required =
          Number(
            task.required || 0
          );


        const referralCount =
          await getReferralCount(
            telegramId
          );


        if (
          referralCount <
          required
        ) {

          return res.status(400)
            .json({

              error:
                `You need ${required} referrals. You currently have ${referralCount}.`,

              required,

              referral_count:
                referralCount

            });
        }
      }


      if (
        task.type ===
        "wallet"
      ) {

        const wallet = String(user.wallet_address || "").trim();


        if (!wallet) {

          return res.status(400)
            .json({

              error:
                "Connect your TON wallet first."

            });
        }


        try {

          Address.parse(
            wallet
          );

        } catch {

          return res.status(400)
            .json({
              error:
                "Invalid TON wallet"
            });
        }


      }


      if (
        task.type ===
        "holder"
      ) {

        const wallet = String(user.wallet_address || "").trim();


        if (!wallet) {

          return res.status(400)
            .json({

              error:
                "Connect your TON wallet first."

            });
        }


        const holder =
          await checkSnpBalance(
            wallet
          );


        if (!holder) {

          return res.status(400)
            .json({

              error:
                `You need at least ${HOLDER_MIN_SNP.toLocaleString("en-US")} SNP in this wallet.`

            });
        }
      }


      if (
        task.type ===
        "telegram"
      ) {

        if (!task.chat) {

          return res.status(500)
            .json({
              error:
                "Telegram task configuration is missing"
            });
        }


        try {

          const member =
            await isTelegramMember(
              task.chat,
              telegramId
            );


          if (!member) {

            return res.status(400)
              .json({

                error:
                  "Join the Telegram channel/group first, then verify."

              });
          }

        } catch (error) {

          console.error(
            "Telegram membership check:",
            error
          );

          return res.status(400)
            .json({

              error:
                "Telegram could not verify membership. Make sure the bot is an administrator of the channel/group."

            });
        }
      }


      if (
        task.type ===
        "external"
      ) {

        return res.status(400)
          .json({

            error:
              "X verification requires X API access and cannot be automatically verified."

          });
      }


      const reward = Math.max(0, safeInt(task.reward, 0));
      let tx;
      try {
        tx = await db.transaction("write");
        await tx.execute({
          sql: `INSERT INTO task_claims
                (telegram_id, task_id, reward, status, created_at)
                VALUES (?, ?, ?, 'Completed', ?)`,
          args: [telegramId, task.id, reward, now()]
        });

        const credit = await tx.execute({
          sql: `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`,
          args: [reward, telegramId]
        });
        if (Number(credit.rowsAffected || 0) !== 1) {
          throw new Error("Could not credit task reward");
        }

        await tx.execute({
          sql: `INSERT INTO transactions
                (telegram_id, type, amount, status, details, created_at)
                VALUES (?, 'TASK', ?, 'Completed', ?, ?)`,
          args: [telegramId, reward, task.name || task.id, now()]
        });

        const referralUserResult = await tx.execute({
          sql: `SELECT referred_by, wallet_address, referral_rewarded FROM users WHERE telegram_id = ? LIMIT 1`,
          args: [telegramId]
        });
        const referralUser = referralUserResult.rows[0];
        const inviterId = referralUser?.referred_by ? String(referralUser.referred_by) : "";
        const commission = referralUser?.wallet_address && Number(referralUser.referral_rewarded || 0) === 1 && inviterId && inviterId !== telegramId
          ? Math.floor(reward * REFERRAL_RATE)
          : 0;

        if (commission > 0) {
          const inviterCredit = await tx.execute({
            sql: `UPDATE users SET balance = balance + ? WHERE telegram_id = ?`,
            args: [commission, inviterId]
          });
          if (Number(inviterCredit.rowsAffected || 0) === 1) {
            await tx.execute({
              sql: `INSERT INTO transactions
                    (telegram_id, type, amount, status, details, created_at)
                    VALUES (?, 'REFERRAL', ?, 'Completed', ?, ?)`,
              args: [inviterId, commission, `${task.name || task.id} referral bonus`, now()]
            });
          }
        }
        await tx.commit();
      } catch (claimError) {
        try { if (tx) await tx.rollback(); } catch (_) {}
        if (String(claimError.message || "").toLowerCase().includes("unique")) {
          return res.status(400).json({ error: "Task already completed", already_completed: true });
        }
        throw claimError;
      }

      const fresh = await getUser(telegramId);


      res.json({

        ok:
          true,

        task_id:
          task.id,

        reward:
          Number(
            task.reward || 0
          ),

        balance:
          Number(
            fresh?.balance || 0
          ),

        referral_count:
          await getReferralCount(
            telegramId
          )

      });

    } catch (error) {

      console.error(
        "/api/tasks/claim",
        error
      );

      res.status(500).json({

        error:
          "Task verification failed",

        details:
          error.message

      });
    }
  }
);


// ============================================================
// FRIENDS
// ============================================================

app.get(
  "/api/friends",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }


      const user =
        await getUser(
          verified.id
        );


      const friends =
        await db.execute({

          sql: `
            SELECT
              telegram_id,
              username,
              created_at,
              balance,
              wallet_address,
              referral_rewarded
            FROM users
            WHERE referred_by = ?
            ORDER BY created_at DESC
          `,

          args: [
            verified.id
          ]
        });


      const earnings =
        await db.execute({

          sql: `
            SELECT
              COALESCE(
                SUM(amount),
                0
              ) AS total
            FROM transactions
            WHERE telegram_id = ?
              AND type = 'REFERRAL'
              AND amount > 0
          `,

          args: [
            verified.id
          ]
        });


      const code =
        user?.referral_code ||
        "";


      const mapped =
        friends.rows.map(
          friend => ({

            telegram_id:
              String(
                friend.telegram_id
              ),

            username:
              friend.username ||
              "",

            created_at:
              friend.created_at,

            balance:
              Number(
                friend.balance ||
                0
              ),

            wallet_connected:
              Boolean(
                friend.wallet_address
              ),

            referral_rewarded:
              Number(
                friend.referral_rewarded ||
                0
              ) === 1,

            status:
              friend.wallet_address
                ? "ACTIVE"
                : "CONNECT WALLET"

          })
        );


      res.json({

        ok:
          true,

        referral_code:
          code,

        referral_link:
          `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(code)}`,

        total_friends:
          mapped.length,

        active_referrals:
          mapped.filter(
            friend =>
              friend.wallet_connected
          ).length,

        total_earnings:
          Number(
            earnings.rows[0]?.total ||
            0
          ),

        invite_reward:
          REFERRAL_JOIN_REWARD,

        referral_rate:
          REFERRAL_RATE,

        friends:
          mapped

      });

    } catch (error) {

      console.error(
        "/api/friends",
        error
      );

      res.status(500).json({
        error:
          "Friends failed"
      });
    }
  }
);


// ============================================================
// HISTORY
// ============================================================

app.get(
  "/api/history",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }


      const rawLimit = Number.parseInt(String(req.query.limit || "10"), 10);
      const rawOffset = Number.parseInt(String(req.query.offset || "0"), 10);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(10, rawLimit)) : 10;
      const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
      const result = await db.execute({
        sql: `SELECT * FROM transactions WHERE telegram_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
        args: [String(verified.id), limit + 1, offset]
      });
      const rows = result.rows || [];
      const hasMore = rows.length > limit;
      res.json({ ok: true, history: rows.slice(0, limit), has_more: hasMore, next_offset: offset + Math.min(rows.length, limit) });

    } catch (error) {

      console.error(
        "/api/history",
        error
      );

      res.status(500).json({
        error:
          "History failed"
      });
    }
  }
);


/* ============================================================
   GET CANCELLABLE WITHDRAWALS
============================================================ */

app.get("/api/withdrawals/cancellable", async (req, res) => {
  try {
    const verified = requireAuth(req, res);
    if (!verified) return;

    const result = await db.execute({
      sql: `
        SELECT withdrawal_id, amount, status
        FROM withdrawals
        WHERE telegram_id = ?
          AND status = 'payment_pending'
        LIMIT 20
      `,
      args: [String(verified.id)]
    });

    res.json({
      ok: true,
      withdrawals: result.rows || []
    });
  } catch (error) {
    console.error("/api/withdrawals/cancellable", error);

    res.status(500).json({
      ok: false,
      error: "Could not load cancellable withdrawals"
    });
  }
});

// ============================================================
// TREASURY INITIALIZATION
// ============================================================

async function initTreasuryPayout() {

  if (
    treasuryInitPromise
  ) {
    return treasuryInitPromise;
  }


  treasuryInitPromise =
    (async () => {

      if (
        !TREASURY_MNEMONIC
      ) {

        throw new Error(
          "TREASURY_MNEMONIC is not configured"
        );
      }


      const words =
        TREASURY_MNEMONIC
          .trim()
          .split(/\s+/)
          .filter(Boolean);


      if (
        words.length < 12
      ) {

        throw new Error(
          "TREASURY_MNEMONIC is invalid"
        );
      }


      treasuryKeyPair =
        await mnemonicToPrivateKey(
          words
        );


      treasuryTonClient =
        new TonClient({

          endpoint:
            TON_RPC,

          apiKey:
            TONCENTER_API_KEY ||
            undefined

        });


      const expected =
        Address.parse(
          TREASURY_WALLET
        );


      treasuryWallet =
        WalletContractV5R1.create({

          workchain:
            0,

          publicKey:
            treasuryKeyPair.publicKey,

          walletId: {
            networkGlobalId:
              -239
          }

        });


      const expectedRaw =
        expected.toRawString();


      const seedRaw =
        treasuryWallet
          .address
          .toRawString();


      if (
        seedRaw !==
        expectedRaw
      ) {

        throw new Error(
          "TREASURY_MNEMONIC does not match Treasury W5 address"
        );
      }


      const master =
        treasuryTonClient.open(
          JettonMaster.create(
            Address.parse(
              SNP_CONTRACT
            )
          )
        );


      treasuryJettonWallet =
        await master.getWalletAddress(
          expected
        );


      return true;

    })();


  try {

    return await treasuryInitPromise;

  } catch (error) {

    treasuryInitPromise =
      null;

    throw error;
  }
}


// ============================================================
// FIND TON FEE PAYMENT
// ============================================================

async function findFeePayment(
  withdrawal
) {

  if (!withdrawal) {
    return null;
  }


  const source =
    String(
      withdrawal.wallet_address ||
      ""
    ).trim();


  const destination =
    String(
      TREASURY_WALLET ||
      ""
    ).trim();


  if (
    !source ||
    !destination
  ) {
    return null;
  }


  const headers =
    TONCENTER_API_KEY
      ? {
          "X-API-Key":
            TONCENTER_API_KEY
        }
      : {};


  const treasury =
    Address.parse(
      destination
    ).toRawString();


  const started =
    withdrawal.created_at
      ? new Date(
          withdrawal.created_at
        ).getTime()
      : Date.now() -
        15 * 60 * 1000;


  const minTime =
    started -
    120000;


  const url =
    `${TONCENTER}/transactions` +
    `?account=${encodeURIComponent(treasury)}` +
    `&limit=100`;


  const response =
    await fetch(
      url,
      {
        headers
      }
    );


  if (!response.ok) {

    throw new Error(
      `TON Center transactions lookup failed: ${response.status}`
    );
  }


  const data =
    await response.json();


  const transactions =
    Array.isArray(data)
      ? data
      : (
          data.transactions ||
          data.result ||
          []
        );


  if (
    !Array.isArray(
      transactions
    )
  ) {
    return null;
  }


  const sourceRaw =
    Address.parse(
      source
    ).toRawString();


  for (
    const tx of transactions
  ) {

    try {

      const txTime =
        Number(
          tx.utime ||
          tx.now ||
          tx.timestamp ||
          0
        ) * 1000;


      if (
        txTime &&
        txTime <
        minTime
      ) {
        continue;
      }


      const inMsg =
        tx.in_msg ||
        tx.inMessage ||
        tx.in_message ||
        null;


      if (!inMsg) {
        continue;
      }


      const value =
        String(
          inMsg.value ??
          inMsg.amount ??
          inMsg.coins ??
          "0"
        );


      if (
        value !==
        String(withdrawal.fee_nano || "0")
      ) {
        continue;
      }


      const msgSource =
        inMsg.source ||
        inMsg.src ||
        inMsg.sender ||
        "";


      if (!msgSource) {
        continue;
      }


      try {

        const msgSourceRaw =
          Address.parse(
            String(msgSource)
          ).toRawString();


        if (
          msgSourceRaw !==
          sourceRaw
        ) {
          continue;
        }

      } catch {

        continue;

      }


      const txHash =
        tx.hash ||
        tx.transaction_hash ||
        tx.tx_hash ||
        tx.id ||
        "";


      const msgHash =
        inMsg.hash ||
        inMsg.message_hash ||
        "";


      return {

        tx_hash:
          txHash ||
          msgHash ||
          "",

        msg_hash:
          msgHash ||
          "",

        value,

        source,

        destination,

        transaction:
          tx

      };

    } catch (error) {

      console.error(
        "Fee transaction parse error:",
        error.message
      );
    }
  }


  return null;
}


// ============================================================
// SEND SNP PAYOUT
// ============================================================

async function sendSnpPayout(
  destination,
  amount,
  withdrawalId
) {

  await initTreasuryPayout();


  const destinationAddress =
    Address.parse(
      destination
    );


  const openedWallet =
    treasuryTonClient.open(
      treasuryWallet
    );


  const seqno =
    await openedWallet.getSeqno();


  const queryId =
    BigInt(
      Date.now()
    );


  const body =
    beginCell()

      .storeUint(
        0x0f8a7ea5,
        32
      )

      .storeUint(
        queryId,
        64
      )

      .storeCoins(
        snpRaw(amount)
      )

      .storeAddress(
        destinationAddress
      )

      .storeAddress(
        Address.parse(
          TREASURY_WALLET
        )
      )

      .storeBit(0)

      .storeCoins(0)

      .storeBit(0)

      .endCell();


  const transfer =
    openedWallet.createTransfer({

      seqno,

      secretKey:
        treasuryKeyPair.secretKey,

      messages: [

        internal({

          to:
            treasuryJettonWallet,

          value:
            TREASURY_JETTON_GAS,

          bounce:
            true,

          body

        })

      ],

      sendMode:
        SendMode.PAY_GAS_SEPARATELY,

      timeout:
        Math.floor(
          Date.now() / 1000
        ) + 120

    });


  await openedWallet.send(
    transfer
  );


  return {

    query_id:
      queryId.toString(),

    seqno,

    treasury_wallet:
      treasuryWallet.address.toString(),

    treasury_jetton_wallet:
      treasuryJettonWallet.toString(),

    destination:
      destinationAddress.toString(),

    amount:
      String(amount),

    withdrawal_id:
      withdrawalId

  };
}


// ============================================================
// FIND REAL SNP PAYOUT TRANSACTION HASH
// ============================================================

async function findPayoutTransaction(
  queryId,
  maxAgeMs = 10 * 60 * 1000
) {

  await initTreasuryPayout();


  const targetQueryId =
    BigInt(
      String(queryId)
    );


  const transactions =
    await treasuryTonClient.getTransactions(
      Address.parse(
        TREASURY_WALLET
      ),
      {
        limit: 50
      }
    );


  const nowMs =
    Date.now();


  for (
    const tx of transactions
  ) {

    try {

      const txNow =
        Number(
          tx.now || 0
        ) * 1000;


      if (
        txNow &&
        nowMs - txNow >
        maxAgeMs
      ) {
        continue;
      }


      if (
        !tx.outMessages
      ) {
        continue;
      }


      const messages =
        tx.outMessages.values();


      for (
        const message of messages
      ) {

        try {

          if (
            !message?.info?.dest
          ) {
            continue;
          }


          const destination =
            message.info.dest
              .toRawString();


          if (
            destination !==
            treasuryJettonWallet
              .toRawString()
          ) {
            continue;
          }


          const slice =
            message.body
              .beginParse();


          if (
            slice.remainingBits <
            96
          ) {
            continue;
          }


          const op =
            slice.loadUint(32);


          const messageQueryId =
            slice.loadUintBig(64);


          if (
            op !==
            0x0f8a7ea5
          ) {
            continue;
          }


          if (
            messageQueryId !==
            targetQueryId
          ) {
            continue;
          }


          const hash =
            tx.hash()
              .toString("hex");


          return {

            tx_hash:
              hash,

            query_id:
              String(queryId),

            lt:
              String(
                tx.lt
              ),

            now:
              tx.now

          };

        } catch (messageError) {
          // ignore
        }
      }

    } catch (error) {
      // ignore
    }
  }


  return null;
}


// ============================================================
// WAIT FOR REAL PAYOUT HASH
// ============================================================

async function waitForPayoutTransaction(
  queryId,
  timeoutMs = 60000
) {

  const started =
    Date.now();


  while (
    Date.now() -
    started <
    timeoutMs
  ) {

    try {

      const found =
        await findPayoutTransaction(
          queryId
        );


      if (found) {
        return found;
      }

    } catch (error) {
      // ignore
    }


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          3000
        )
    );
  }


  return null;
}


// Verify current on-chain SNP holdings using TONAPI. Fail closed if the balance cannot be verified.
async function getCurrentSnpHolding(walletAddress) {
  const wallet = Address.parse(String(walletAddress || "").trim()).toString({ bounceable: false });
  const endpoint = `https://tonapi.io/v2/accounts/${encodeURIComponent(wallet)}/jettons`;
  const response = await fetch(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Could not verify your current SNP holdings on-chain. Please try again later.");
  const data = await response.json();
  const masterRaw = Address.parse(String(SNP_CONTRACT).trim()).toRawString().toLowerCase();
  const entries = Array.isArray(data.balances) ? data.balances : [];
  for (const entry of entries) {
    const jettonAddress = entry?.jetton?.address || entry?.jetton?.master?.address || "";
    let raw = "";
    try { raw = Address.parse(String(jettonAddress)).toRawString().toLowerCase(); } catch (_) { continue; }
    if (raw === masterRaw) {
      const balanceRaw = BigInt(String(entry.balance || "0"));
      return Number(balanceRaw) / (10 ** SNP_DECIMALS);
    }
  }
  return 0;
}

// ============================================================
// WITHDRAW CREATE
// ============================================================

app.post(
  "/api/withdraw/create",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }


      const telegramId =
        verified.id;


      const amount = safeInt(req.body.amount, 0);
      const payoutAmount = amount;
      const feeNanoBig = BigInt(amount) * WITHDRAW_FEE_NANO_PER_SNP;
      const feeNano = feeNanoBig.toString();
      const feeTon = Number(feeNanoBig) / 1e9;


      const requestedWallet =
        String(
          req.body.wallet_address ||
          ""
        ).trim();


      if (amount <= 0 || payoutAmount <= 0 || !Number.isSafeInteger(amount)) {
  return res.status(400).json({
    error: "Invalid withdrawal amount"
  });
}


      const user =
        await getUser(
          telegramId
        );


      if (!user) {

        return res.status(404)
          .json({
            error:
              "User not found"
          });
      }


      if (
        !requestedWallet
      ) {

        return res.status(400)
          .json({
            error:
              "Connect your wallet first"
          });
      }


      let normalizedWallet;

      try {

        normalizedWallet =
          Address.parse(
            requestedWallet
          ).toString();

      } catch {

        return res.status(400)
          .json({
            error:
              "Invalid TON wallet"
          });
      }


      if (!user.wallet_address) {
        return res.status(400).json({ error: "Connect your TON wallet first" });
      }

      const saved = normalizeAddress(user.wallet_address);
      const requested = normalizeAddress(normalizedWallet);
      if (saved !== requested) {
        return res.status(400).json({ error: "Wallet does not match your connected wallet" });
      }

      let currentSnpHolding;
      try {
        currentSnpHolding = await getCurrentSnpHolding(normalizedWallet);
      } catch (holdingError) {
        return res.status(503).json({ error: holdingError.message || "Could not verify SNP holdings. Please try again later." });
      }
      if (currentSnpHolding < MIN_WITHDRAW_HOLDING_SNP) {
        return res.status(403).json({
          error: `Withdrawals require at least ${MIN_WITHDRAW_HOLDING_SNP.toLocaleString()} SNP in your connected wallet. Current verified balance: ${Math.floor(currentSnpHolding).toLocaleString()} SNP.`,
          required_holding_snp: MIN_WITHDRAW_HOLDING_SNP,
          current_holding_snp: currentSnpHolding
        });
      }

      const withdrawalId =
        `SNP-${Date.now()}-${crypto
          .randomBytes(4)
          .toString("hex")
          .toUpperCase()}`;


      const deducted =
        await db.execute({

          sql: `
            UPDATE users
            SET balance = balance - ?
            WHERE telegram_id = ?
              AND balance >= ?
          `,

          args: [
            amount,
            telegramId,
            amount
          ]
        });


      if (
        !deducted.rowsAffected
      ) {

        return res.status(400)
          .json({
            error:
              "Not enough SNP"
          });
      }


      try {

        await db.execute({

          sql: `
            INSERT INTO withdrawals
            (
              withdrawal_id,
              telegram_id,
              wallet_address,
              amount,
              fee_ton,
              fee_nano,
              treasury_wallet,
              token_contract,
              status,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,

          args: [

            withdrawalId,

            telegramId,

            normalizedWallet,

            payoutAmount,

            feeTon.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""),

            feeNano,

            TREASURY_WALLET,

            SNP_CONTRACT,

            "payment_pending",

            now()

          ]
        });


        await addTransaction(

          telegramId,

          "WITHDRAW",

          -amount,

          "Reserved",

          `Withdrawal ${withdrawalId}`

        );


      } catch (error) {

        await db.execute({

          sql: `
            UPDATE users
            SET balance = balance + ?
            WHERE telegram_id = ?
          `,

          args: [
            amount,
            telegramId
          ]
        });

        throw error;
      }


      const fresh =
        await getUser(
          telegramId
        );


      res.json({

        ok:
          true,

        withdrawal_id:
          withdrawalId,

        fee_nano:
          feeNano,

        fee_ton:
          feeTon,

        treasury_wallet:
          TREASURY_WALLET,

        status:
          "payment_pending",

        balance:
          Number(
            fresh.balance || 0
          )

      });

    } catch (error) {

      console.error(
        "/api/withdraw/create",
        error
      );

      res.status(500).json({
        error:
          "Withdrawal creation failed"
      });
    }
  }
);


// ============================================================
// WITHDRAW VERIFY
// ============================================================

app.post(
  "/api/withdraw/verify",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }


      const id =
        String(
          req.body.withdrawal_id ||
          ""
        );


      let result =
        await db.execute({

          sql: `
            SELECT *
            FROM withdrawals
            WHERE withdrawal_id = ?
              AND telegram_id = ?
            LIMIT 1
          `,

          args: [
            id,
            verified.id
          ]
        });


      let withdrawal =
        result.rows[0];


      if (!withdrawal) {

        return res.status(404)
          .json({
            error:
              "Withdrawal not found"
          });
      }


      if (
        withdrawal.status ===
        "payment_pending"
      ) {

        let feePayment;


        try {

          feePayment =
            await findFeePayment(
              withdrawal
            );

        } catch (error) {

          return res.status(503)
            .json({

              error:
                "Could not verify the TON fee yet. Please try again."

            });
        }


        if (!feePayment) {

          return res.status(400)
            .json({

              error:
                "The 0.1 TON fee payment has not been confirmed yet. Please wait a few seconds and try again.",

              status:
                "payment_pending"

            });
        }


        const feeHash =
          feePayment.tx_hash ||
          feePayment.msg_hash ||
          "";


        await db.execute({

          sql: `
            UPDATE withdrawals
            SET
              status = 'fee_submitted',
              fee_tx_hash = ?,
              verified_at = ?
            WHERE withdrawal_id = ?
              AND telegram_id = ?
              AND status = 'payment_pending'
          `,

          args: [

            feeHash,

            now(),

            id,

            verified.id

          ]
        });


        result =
          await db.execute({

            sql: `
              SELECT *
              FROM withdrawals
              WHERE withdrawal_id = ?
                AND telegram_id = ?
              LIMIT 1
            `,

            args: [
              id,
              verified.id
            ]
          });


        withdrawal =
          result.rows[0];
      }


      if (
        withdrawal.status ===
        "payout_submitted"
      ) {

        if (
          withdrawal.payout_query_id
        ) {

          const realTx =
            await findPayoutTransaction(
              withdrawal.payout_query_id
            );


          if (realTx) {

            await db.execute({

              sql: `
                UPDATE withdrawals
                SET
                  status = 'paid',
                  payout_tx_hash = ?,
                  completed_at = ?
                WHERE withdrawal_id = ?
                  AND telegram_id = ?
                  AND status = 'payout_submitted'
              `,

              args: [

                realTx.tx_hash,

                now(),

                id,

                verified.id

              ]
            });

          } else {

            return res.json({

              ok:
                true,

              withdrawal: {
                ...withdrawal,
                status:
                  "payout_submitted"
              },

              message:
                "SNP transaction has been submitted. Waiting for the real blockchain transaction hash."

            });
          }
        }
      }


      result =
        await db.execute({

          sql: `
            SELECT *
            FROM withdrawals
            WHERE withdrawal_id = ?
              AND telegram_id = ?
            LIMIT 1
          `,

          args: [
            id,
            verified.id
          ]
        });


      withdrawal =
        result.rows[0];


      if (
        withdrawal.status ===
          "fee_submitted"

        ||

        withdrawal.status ===
          "fee_paid_pending_payout"
      ) {

        const claimed =
          await db.execute({

            sql: `
              UPDATE withdrawals
              SET status = 'processing'
              WHERE withdrawal_id = ?
                AND telegram_id = ?
                AND status IN (
                  'fee_submitted',
                  'fee_paid_pending_payout'
                )
            `,

            args: [
              id,
              verified.id
            ]
          });


        if (
          claimed.rowsAffected
        ) {

          try {

            const payout =
              await sendSnpPayout(

                withdrawal.wallet_address,

                Number(
                  withdrawal.amount || 0
                ),

                id

              );


            await db.execute({

              sql: `
                UPDATE withdrawals
                SET
                  status = 'payout_submitted',
                  payout_query_id = ?,
                  payout_submitted_at = ?
                WHERE withdrawal_id = ?
                  AND telegram_id = ?
                  AND status = 'processing'
              `,

              args: [

                payout.query_id,

                now(),

                id,

                verified.id

              ]
            });


            const realTx =
              await waitForPayoutTransaction(
                payout.query_id,
                60000
              );


            if (realTx) {

              await db.execute({

                sql: `
                  UPDATE withdrawals
                  SET
                    status = 'paid',
                    payout_tx_hash = ?,
                    completed_at = ?
                  WHERE withdrawal_id = ?
                    AND telegram_id = ?
                    AND status = 'payout_submitted'
                `,

                args: [

                  realTx.tx_hash,

                  now(),

                  id,

                  verified.id

                ]
              });

            }

          } catch (payoutError) {

            await db.execute({

              sql: `
                UPDATE withdrawals
                SET status = 'fee_paid_pending_payout'
                WHERE withdrawal_id = ?
                  AND telegram_id = ?
                  AND status = 'processing'
              `,

              args: [
                id,
                verified.id
              ]
            });
          }
        }
      }


      const fresh =
        await db.execute({

          sql: `
            SELECT *
            FROM withdrawals
            WHERE withdrawal_id = ?
              AND telegram_id = ?
            LIMIT 1
          `,

          args: [
            id,
            verified.id
          ]
        });


      res.json({

        ok:
          true,

        withdrawal:
          fresh.rows[0]

      });

    } catch (error) {

      console.error(
        "/api/withdraw/verify",
        error
      );

      res.status(500).json({

        error:
          "Withdrawal verification failed",

        details:
          error.message

      });
    }
  }
);


// ============================================================
// WITHDRAW CANCEL
// ============================================================

app.post(
  "/api/withdraw/cancel",
  async (req, res) => {

    try {

      const verified =
        requireAuth(
          req,
          res
        );

      if (!verified) {
        return;
      }


      const id =
        String(
          req.body.withdrawal_id ||
          ""
        );


      const result =
        await db.execute({

          sql: `
            SELECT *
            FROM withdrawals
            WHERE withdrawal_id = ?
              AND telegram_id = ?
            LIMIT 1
          `,

          args: [
            id,
            verified.id
          ]
        });


      if (
        !result.rows.length
      ) {

        return res.status(404)
          .json({
            error:
              "Withdrawal not found"
          });
      }


      const withdrawal =
        result.rows[0];


      if (
        withdrawal.status !==
        "payment_pending"
      ) {

        return res.status(400)
          .json({

            error:
              "This withdrawal can no longer be cancelled"

          });
      }


      const changed =
        await db.execute({

          sql: `
            UPDATE withdrawals
            SET status = 'cancelled'
            WHERE withdrawal_id = ?
              AND telegram_id = ?
              AND status = 'payment_pending'
          `,

          args: [
            id,
            verified.id
          ]
        });


      if (
        changed.rowsAffected
      ) {

        await db.execute({

          sql: `
            UPDATE users
            SET balance = balance + ?
            WHERE telegram_id = ?
          `,

          args: [

            Number(
              withdrawal.amount ||
              0
            ),

            verified.id

          ]
        });


        await addTransaction(

          verified.id,

          "WITHDRAW",

          Number(
            withdrawal.amount ||
            0
          ),

          "Refunded",

          `Cancelled ${id}`

        );
      }


      const user =
        await getUser(
          verified.id
        );


      res.json({

        ok:
          true,

        balance:
          Number(
            user.balance || 0
          )

      });

    } catch (error) {

      console.error(
        "/api/withdraw/cancel",
        error
      );

      res.status(500).json({

        error:
          "Withdrawal cancellation failed"

      });
    }
  }
);


// ============================================================
// TELEGRAM /START WEBHOOK
// ============================================================

app.post(
  "/telegram/webhook",
  async (req, res) => {

    res.sendStatus(200);


    try {

      const update =
        req.body;


      const message =
        update?.message;


      if (
        !message?.chat?.id
      ) {
        return;
      }


      if (
        message.chat.type !==
        "private"
      ) {
        return;
      }


      const text = String(message.text || "").trim();
      const chatId = String(message.chat.id);
      const senderId = String(message.from?.id || "");
      const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

      // Anyone may ask for their own numeric Telegram ID. This does not grant admin access.
      if (/^\/myid(?:@\w+)?$/i.test(text)) {
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `Your Telegram ID: ${senderId}\nSet this value as ADMIN_TELEGRAM_ID in Render to enable admin broadcasts.`
        });
        return;
      }

      const isAdmin = !!ADMIN_TELEGRAM_ID && senderId === ADMIN_TELEGRAM_ID && chatId === ADMIN_TELEGRAM_ID;

      if (/^\/broadcast(?:@\w+)?$/i.test(text)) {
        if (!isAdmin) {
          await telegramApi("sendMessage", { chat_id: chatId, text: "⛔ This command is only available to the bot administrator." });
          return;
        }
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: "📣 Broadcast mode enabled. Send the exact message, photo, video, or other supported post you want to forward to registered users. Then use /broadcast_send to confirm or /broadcast_cancel to cancel."
        });
        globalThis.__sinapsBroadcastDraft = { adminId: senderId, chatId, messageId: null };
        return;
      }

      if (/^\/broadcast_cancel(?:@\w+)?$/i.test(text)) {
        if (!isAdmin) {
          await telegramApi("sendMessage", { chat_id: chatId, text: "⛔ Admin only." });
          return;
        }
        globalThis.__sinapsBroadcastDraft = null;
        await telegramApi("sendMessage", { chat_id: chatId, text: "Broadcast cancelled." });
        return;
      }

      if (/^\/broadcast_send(?:@\w+)?$/i.test(text)) {
        if (!isAdmin) {
          await telegramApi("sendMessage", { chat_id: chatId, text: "⛔ Admin only." });
          return;
        }
        const draft = globalThis.__sinapsBroadcastDraft;
        if (!draft || draft.adminId !== senderId || !draft.messageId) {
          await telegramApi("sendMessage", { chat_id: chatId, text: "No message is ready. Send /broadcast first, then send the message you want to broadcast." });
          return;
        }
        globalThis.__sinapsBroadcastDraft = null;
        await telegramApi("sendMessage", { chat_id: chatId, text: "⏳ Broadcast started. I will send a report when it finishes." });
        try {
          const result = await db.execute({ sql: "SELECT DISTINCT telegram_id FROM users", args: [] });
          const ids = [...new Set(result.rows.map(row => String(row.telegram_id || "")).filter(id => /^\d+$/.test(id)))];
          let sent = 0, failed = 0;
          for (const targetId of ids) {
            if (targetId === senderId) continue;
            const copied = await telegramApi("copyMessage", { chat_id: targetId, from_chat_id: draft.chatId, message_id: draft.messageId });
            if (copied) sent++; else failed++;
            // Stay comfortably below Telegram's usual per-chat/global send limits.
            await new Promise(resolve => setTimeout(resolve, 45));
          }
          await telegramApi("sendMessage", { chat_id: chatId, text: `✅ Broadcast finished\n\n👥 Registered users: ${ids.length}\n📨 Sent: ${sent}\n❌ Failed: ${failed}` });
        } catch (broadcastError) {
          console.error("SINAPS broadcast failed:", broadcastError);
          await telegramApi("sendMessage", { chat_id: chatId, text: "❌ Broadcast failed while reading the users database. Check Render logs." });
        }
        return;
      }

      // While the admin is composing a broadcast, remember the message to copy.
      const draft = globalThis.__sinapsBroadcastDraft;
      if (draft && draft.adminId === senderId && draft.chatId === chatId && !/^\/broadcast(?:_|@|\s|$)/i.test(text)) {
        draft.messageId = message.message_id;
        await telegramApi("sendMessage", { chat_id: chatId, text: "Preview received. When ready, send /broadcast_send to deliver it to users, or /broadcast_cancel to discard it." });
        return;
      }

      if (!/^\/start(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
        return;
      }

      const photoUrl =
        "https://github.com/sadeghi1315/sinaps-tap-to-earn/blob/main/preview.png?raw=true";


      const miniAppUrl =
        "https://sadeghi1315.github.io/sinaps-tap-to-earn/";


      await telegramApi(
        "sendPhoto",
        {

          chat_id:
            chatId,

          photo:
            photoUrl,

          caption:
`🚀 Welcome to SINAPS

Tap • Earn • Grow

Start earning SNP and build your SINAPS balance.

🎁 Daily Rewards
⚡ Boosts
👥 Referral Rewards
💎 TON Wallet

Your SINAPS journey starts here.`,

          reply_markup: {

            inline_keyboard: [

              [

                {

                  text:
                    "🚀 START SINAPS",

                  web_app: {

                    url:
                      miniAppUrl

                  }

                }

              ]

            ]

          }

        }
      );

    } catch (error) {
      // ignore
    }
  }
);


// ============================================================
// TELEGRAM WEBHOOK SETUP (NON-BLOCKING)
// ============================================================

async function setupTelegramWebhook() {

  if (!BOT_TOKEN) {
    return;
  }

  const webhookUrl =
    "https://sinaps-backend.onrender.com/telegram/webhook";

  telegramApi("setWebhook", { url: webhookUrl })
    .then(result => {
      if (result) console.log("Telegram webhook setup success");
    })
    .catch(error => {
      console.error("Telegram webhook setup failed (non-blocking):", error?.message);
    });
}


// ============================================================
// START SERVER
// ============================================================

async function start() {

  try {

    await initDB();

    setupTelegramWebhook();

    app.listen(

      PORT,

      () => {

        console.log(
          `SINAPS backend v5.0.0 running on ${PORT}`
        );

      }

    );

  } catch (error) {

    console.error(
      "Startup error:",
      error
    );

    process.exit(1);
  }
}


start();
