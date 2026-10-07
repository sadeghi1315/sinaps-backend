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

const FEE_NANO =
  "100000000";

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
  100;

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
// TREASURY PAYOUT STATE
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

    {
      level: 2,
      price: 2000,
      name: "Tap ×2",
      description: "2 SNP per tap"
    },

    {
      level: 3,
      price: 3000,
      name: "Tap ×3",
      description: "3 SNP per tap"
    },

    {
      level: 4,
      price: 5000,
      name: "Tap ×4",
      description: "4 SNP per tap"
    },

    {
      level: 5,
      price: 8000,
      name: "Tap ×5",
      description: "5 SNP per tap"
    }

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
// TASKS
// ============================================================

const TASKS = [

  {
    id: "channel",
    name: "Join SINAPS Channel",
    reward: 100,
    icon: "📢",
    url: "https://t.me/SINAPS_COIN",
    chat: "@SINAPS_COIN",
    type: "telegram"
  },

  {
    id: "group",
    name: "Join SINAPS Group",
    reward: 70,
    icon: "👥",
    url: "https://t.me/SINAPS_Group",
    chat: "@SINAPS_Group",
    type: "telegram"
  },

  {
    id: "holder",
    name: "Hold 50,000 SNP",
    reward: 1000,
    icon: "💎",
    url: "#",
    type: "holder"
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


// ============================================================
// SNP RAW AMOUNT
// ============================================================

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
          gained *
          interval
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
// REFERRAL
// ============================================================

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

        String(
          user.referred_by
        )

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


async function qualifyReferral(
  telegramId
) {

  try {

    const userResult =
      await db.execute({

        sql: `
          SELECT
            telegram_id,
            referred_by,
            wallet_address,
            referral_rewarded
          FROM users
          WHERE telegram_id = ?
          LIMIT 1
        `,

        args: [
          String(telegramId)
        ]

      });

    if (
      !userResult.rows.length
    ) {
      return 0;
    }

    const user =
      userResult.rows[0];

    if (!user.referred_by) {
      return 0;
    }

    if (
      !user.wallet_address ||
      String(
        user.wallet_address
      ).trim() === ""
    ) {
      return 0;
    }

    if (
      Number(
        user.referral_rewarded || 0
      ) === 1
    ) {
      return 0;
    }

    if (
      String(
        user.referred_by
      ) ===
      String(
        user.telegram_id
      )
    ) {
      return 0;
    }

    const changed =
      await db.execute({

        sql: `
          UPDATE users
          SET referral_rewarded = 1
          WHERE telegram_id = ?
            AND referred_by IS NOT NULL
            AND referred_by != ?
            AND wallet_address IS NOT NULL
            AND wallet_address != ''
            AND referral_rewarded = 0
        `,

        args: [

          String(telegramId),

          String(telegramId)

        ]

      });

    if (
      Number(
        changed.rowsAffected || 0
      ) !== 1
    ) {
      return 0;
    }

    const referrerResult =
      await db.execute({

        sql: `
          SELECT telegram_id
          FROM users
          WHERE telegram_id = ?
          LIMIT 1
        `,

        args: [
          String(
            user.referred_by
          )
        ]

      });

    if (
      !referrerResult.rows.length
    ) {

      await db.execute({

        sql: `
          UPDATE users
          SET referral_rewarded = 0
          WHERE telegram_id = ?
        `,

        args: [
          String(telegramId)
        ]

      });

      return 0;

    }

    const referrer =
      referrerResult.rows[0];

    await db.execute({

      sql: `
        UPDATE users
        SET balance = balance + ?
        WHERE telegram_id = ?
      `,

      args: [

        REFERRAL_JOIN_REWARD,

        String(
          referrer.telegram_id
        )

      ]

    });

    await addTransaction(

      referrer.telegram_id,

      "REFERRAL",

      REFERRAL_JOIN_REWARD,

      "Completed",

      `Referral reward for user ${String(telegramId)} connecting TON wallet`

    );

    console.log(
      `Referral qualified: ${telegramId} -> ${referrer.telegram_id} (+${REFERRAL_JOIN_REWARD} SNP)`
    );

    return REFERRAL_JOIN_REWARD;

  } catch (error) {

    console.error(
      "qualifyReferral error:",
      error
    );

    return 0;

  }

}


async function rewardUser(
  telegramId,
  amount,
  type,
  details
) {

  await db.execute({

    sql: `
      UPDATE users
      SET balance = balance + ?
      WHERE telegram_id = ?
    `,

    args: [

      Number(amount),

      String(telegramId)

    ]

  });

  await addTransaction(

    telegramId,

    type,

    amount,

    "Completed",

    details

  );

  await rewardReferralOwner(

    telegramId,

    amount,

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

      console.log(
        `Added: ${table}.${column}`
      );

    }

  } catch (error) {

    if (
      String(
        error.message || ""
      )
        .toLowerCase()
        .includes(
          "duplicate column"
        )
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

    CREATE TABLE IF NOT EXISTS users (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      telegram_id TEXT UNIQUE NOT NULL,

      username TEXT,

      balance INTEGER DEFAULT 0,

      energy INTEGER DEFAULT 1000,

      max_energy INTEGER DEFAULT 1000,

      last_energy_update TEXT,

      created_at TEXT,

      last_daily_bonus TEXT,

      daily_streak INTEGER DEFAULT 0,

      referral_code TEXT UNIQUE,

      referred_by TEXT,

      wallet_address TEXT,

      tap_power INTEGER DEFAULT 1,

      tap_boost_level INTEGER DEFAULT 1,

      energy_boost_level INTEGER DEFAULT 1,

      recharge_multiplier INTEGER DEFAULT 1,

      recharge_level INTEGER DEFAULT 1,

      referral_rewarded INTEGER DEFAULT 0

    )

  `);

  const columns = [

    [
      "username",
      "TEXT"
    ],

    [
      "balance",
      "INTEGER DEFAULT 0"
    ],

    [
      "energy",
      "INTEGER DEFAULT 1000"
    ],

    [
      "max_energy",
      "INTEGER DEFAULT 1000"
    ],

    [
      "last_energy_update",
      "TEXT"
    ],

    [
      "created_at",
      "TEXT"
    ],

    [
      "last_daily_bonus",
      "TEXT"
    ],

    [
      "daily_streak",
      "INTEGER DEFAULT 0"
    ],

    [
      "referral_code",
      "TEXT"
    ],

    [
      "referred_by",
      "TEXT"
    ],

    [
      "wallet_address",
      "TEXT"
    ],

    [
      "tap_power",
      "INTEGER DEFAULT 1"
    ],

    [
      "tap_boost_level",
      "INTEGER DEFAULT 1"
    ],

    [
      "energy_boost_level",
      "INTEGER DEFAULT 1"
    ],

    [
      "recharge_multiplier",
      "INTEGER DEFAULT 1"
    ],

    [
      "recharge_level",
      "INTEGER DEFAULT 1"
    ],

    [
      "referral_rewarded",
      "INTEGER DEFAULT 0"
    ]

  ];

  for (
    const [column, definition]
    of columns
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

      created_at TEXT,

      verified_at TEXT,

      completed_at TEXT

    )

  `);


  await db.execute(`

    UPDATE users
    SET tap_power = 1
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

        String(
          row.telegram_id
        )

      ]

    });

  }


  console.log(
    "SINAPS database migration completed successfully."
  );

}


// ============================================================
// TELEGRAM API
// ============================================================

async function telegramApi(
  method,
  body
) {

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json"

        },

        body:
          JSON.stringify(body)

      }
    );

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

    throw new Error(
      data.description ||
      `Telegram ${method} failed`
    );

  }

  return data.result;

}


async function isTelegramMember(
  chat,
  telegramId
) {

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

}


// ============================================================
// TELEGRAM /START
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

      const text =
        String(
          message.text || ""
        );

      if (
        !/^\/start(?:@\w+)?(?:\s+.*)?$/i
          .test(text)
      ) {
        return;
      }

      const chatId =
        message.chat.id;

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

      console.error(
        "Telegram /start error:",
        error
      );

    }

  }
);


// ============================================================
// SNP HOLDER CHECK
// ============================================================

async function checkSnpBalance(wallet) {

  if (!wallet) {
    return false;
  }

  try {

    const headers =
      TONCENTER_API_KEY
        ? {
            "X-API-Key": TONCENTER_API_KEY
          }
        : {};

    // Normalize the user's TON address
    const ownerAddress =
      Address.parse(
        String(wallet).trim()
      ).toString();

    const jettonMasterAddress =
      Address.parse(
        SNP_CONTRACT
      ).toString();

    // IMPORTANT:
    // owner_address = user's TON wallet
    // jetton_address = SNP master contract
    const url =
      `${TONCENTER}/jetton/wallets` +
      `?owner_address=${encodeURIComponent(ownerAddress)}` +
      `&jetton_address=${encodeURIComponent(jettonMasterAddress)}` +
      `&limit=10`;

    console.log("=================================");
    console.log("SNP HOLDER CHECK");
    console.log("Owner wallet:", ownerAddress);
    console.log("SNP contract:", jettonMasterAddress);
    console.log("URL:", url);
    console.log("=================================");

    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers
        }
      );

    if (!response.ok) {

      const errorText =
        await response.text().catch(
          () => ""
        );

      console.error(
        "TON Center holder check:",
        response.status,
        errorText
      );

      throw new Error(
        `Unable to verify SNP balance: ${response.status}`
      );

    }

    const data =
      await response.json();

    console.log(
      "TON Center SNP response:",
      JSON.stringify(data)
    );

    const wallets =
      Array.isArray(
        data?.jetton_wallets
      )
        ? data.jetton_wallets
        : [];

    if (!wallets.length) {

      console.log(
        "No SNP Jetton Wallet found for this owner."
      );

      return false;

    }

    // There should normally be one wallet for this
    // owner + SNP master combination.
    const row =
      wallets.find(
        item =>
          String(
            item?.jetton || ""
          ).toLowerCase() ===
          String(
            SNP_CONTRACT
          ).toLowerCase()
      ) ||
      wallets[0];

    const rawBalance =
      BigInt(
        String(
          row?.balance || "0"
        )
      );

    const requiredRaw =
      BigInt(
        HOLDER_MIN_SNP
      ) *
      1000000000n;

    console.log(
      "SNP raw balance:",
      rawBalance.toString()
    );

    console.log(
      "Required raw balance:",
      requiredRaw.toString()
    );

    const balanceSnp =
      Number(rawBalance) /
      1000000000;

    console.log(
      "SNP balance:",
      balanceSnp
    );

    const holder =
      rawBalance >= requiredRaw;

    console.log(
      "Holder 50,000 SNP:",
      holder
    );

    return holder;

  } catch (error) {

    console.error(
      "checkSnpBalance error:",
      error
    );

    throw error;

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
        "4.2.0"

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
        verified.id;

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
            String(telegramId)
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

          sql: `
            UPDATE users
            SET username = ?
            WHERE telegram_id = ?
          `,

          args: [

            username,

            telegramId

          ]

        });

      }


      user =
        await syncEnergy(
          telegramId
        );


      res.json({

        ok:
          true,

        user:
          publicUser(user)

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

      const count =
        Math.min(
          50,
          Math.max(
            1,
            safeInt(
              req.body.count,
              1
            )
          )
        );

      const energy =
        Number(
          user.energy || 0
        );

      const tapPower =
        Number(
          user.tap_power || 1
        );

      const usable =
        Math.min(
          count,
          energy
        );

      if (usable <= 0) {

        return res.status(400)
          .json({

            error:
              "No energy",

            user:
              publicUser(user)

          });

      }

      const reward =
        usable *
        tapPower;

      const result =
        await db.execute({

          sql: `
            UPDATE users
            SET
              balance = balance + ?,
              energy = energy - ?,
              last_energy_update = ?
            WHERE telegram_id = ?
              AND energy >= ?
          `,

          args: [

            reward,

            usable,

            now(),

            telegramId,

            usable

          ]

        });

      if (!result.rowsAffected) {

        return res.status(409)
          .json({

            error:
              "Tap conflict. Try again."

          });

      }

      const updated =
        await getUser(
          telegramId
        );

      res.json({

        ok:
          true,

        taps:
          usable,

        reward,

        user:
          publicUser(updated)

      });


    } catch (error) {

      console.error(
        "/api/tap",
        error
      );

      res.status(500).json({

        error:
          "Tap failed"

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

            next.level,

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

            next.level,

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

  let nextDay =
    1;


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


  if (
    nextDay > 30
  ) {
    nextDay = 1;
  }


  let claimedThrough =
    0;


  if (
    claimedToday
  ) {

    claimedThrough =
      Math.min(
        30,
        Math.max(
          0,
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

    claimedThrough =
      Math.min(
        30,
        Math.max(
          0,
          streak
        )
      );

  }


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

        ok:
          true,

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

        ok:
          true,

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

            ok:
              false,

            error:
              "Daily reward already claimed",

            claimed_today:
              true,

            claimedToday:
              true,

            today_claimed:
              true,

            todayClaimed:
              true,

            is_claimed:
              true,

            isClaimed:
              true,

            can_claim:
              false,

            canClaim:
              false,

            last_claim_date:
              last,

            daily

          });

      }


      let day =
        1;

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


      if (
        day > 30
      ) {
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
          updated.rowsAffected ||
          0
        ) !== 1
      ) {

        return res.status(409)
          .json({

            ok:
              false,

            error:
              "Daily reward already claimed",

            claimed_today:
              true,

            claimedToday:
              true,

            can_claim:
              false,

            canClaim:
              false

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

        ok:
          true,

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

        today_claimed:
          true,

        todayClaimed:
          true,

        is_claimed:
          true,

        isClaimed:
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

      if (
        wallet.length < 20 ||
        wallet.length > 150
      ) {

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

          wallet,

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
          wallet,

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
// TASKS
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

      const result =
        await db.execute({

          sql: `
            SELECT task_id
            FROM task_claims
            WHERE telegram_id = ?
          `,

          args: [
            verified.id
          ]

        });

      const claimed =
        new Set(
          result.rows.map(
            x =>
              String(
                x.task_id
              )
          )
        );

      res.json({

        ok:
          true,

        tasks:
          TASKS.map(
            task => ({

              ...task,

              completed:
                claimed.has(
                  task.id
                ),

              action:
                task.type ===
                "holder"
                  ? "VERIFY"
                  : "JOIN & VERIFY"

            })
          )

      });


    } catch (error) {

      console.error(
        "/api/tasks",
        error
      );

      res.status(500).json({

        error:
          "Tasks failed"

      });

    }

  }
);


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
        verified.id;

      const taskId =
        String(
          req.body.task_id ||
          ""
        );

      const task =
        TASKS.find(
          t =>
            t.id === taskId
        );

      if (!task) {

        return res.status(400)
          .json({

            error:
              "Task not found"

          });

      }

      const existing =
        await db.execute({

          sql: `
            SELECT id
            FROM task_claims
            WHERE telegram_id = ?
              AND task_id = ?
          `,

          args: [

            telegramId,

            taskId

          ]

        });

      if (
        existing.rows.length
      ) {

        return res.status(400)
          .json({

            error:
              "Task already completed"

          });

      }


      if (
        task.type ===
        "telegram"
      ) {

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
                  "Join the channel/group first, then verify."

              });

          }

        } catch (error) {

          console.error(
            "membership check",
            error
          );

          return res.status(400)
            .json({

              error:
                "Telegram could not verify membership. Make the bot an admin in the channel/group."

            });

        }

      }


      if (
        task.type ===
        "holder"
      ) {

        const user =
          await getUser(
            telegramId
          );

        const wallet =
          String(
            req.body.wallet_address ||
            user?.wallet_address ||
            ""
          ).trim();

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


      await db.execute({

        sql: `
          INSERT INTO task_claims
          (
            telegram_id,
            task_id,
            reward,
            status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,

        args: [

          telegramId,

          task.id,

          task.reward,

          "Completed",

          now()

        ]

      });


      await rewardUser(

        telegramId,

        task.reward,

        "TASK",

        task.name

      );


      const user =
        await getUser(
          telegramId
        );

      res.json({

        ok:
          true,

        reward:
          task.reward,

        balance:
          Number(
            user.balance || 0
          )

      });


    } catch (error) {

      console.error(
        "/api/tasks/claim",
        error
      );

      res.status(500).json({

        error:
          "Task verification failed"

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

      const result =
        await db.execute({

          sql: `
            SELECT *
            FROM transactions
            WHERE telegram_id = ?
            ORDER BY id DESC
            LIMIT 100
          `,

          args: [
            verified.id
          ]

        });

      res.json({

        ok:
          true,

        history:
          result.rows

      });


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


// ============================================================
// W5 TREASURY INITIALIZATION
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


      console.log(
        "Initializing Treasury W5..."
      );


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


      console.log(
        "================================="
      );

      console.log(
        "Treasury expected:",
        expectedRaw
      );

      console.log(
        "Seed W5 address:",
        seedRaw
      );


      if (
        seedRaw !==
        expectedRaw
      ) {

        throw new Error(
          "TREASURY_MNEMONIC does not match Treasury W5 address"
        );

      }


      console.log(
        "TREASURY WALLET TYPE: W5 / V5R1"
      );


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


      console.log(
        "Treasury SNP Jetton Wallet:",
        treasuryJettonWallet.toString()
      );

      console.log(
        "SNP contract:",
        SNP_CONTRACT
      );

      console.log(
        "================================="
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


  console.log(
    "Checking TON fee payment..."
  );

  console.log(
    "Fee source:",
    source
  );

  console.log(
    "Fee destination:",
    destination
  );

  console.log(
    "Required nanoTON:",
    FEE_NANO
  );


  let url =
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
        String(FEE_NANO)
      ) {
        continue;
      }


      const msgSource =
        inMsg.source ||
        inMsg.src ||
        inMsg.sender ||
        "";


      if (
        msgSource
      ) {

        try {

          const srcRaw =
            Address.parse(
              String(
                msgSource
              )
            ).toRawString();

          const sourceRaw =
            Address.parse(
              source
            ).toRawString();

          if (
            srcRaw !==
            sourceRaw
          ) {
            continue;
          }

        } catch {

          if (
            String(
              msgSource
            ) !==
            source
          ) {
            continue;
          }

        }

      } else {

        continue;

      }


      const destinationFromMsg =
        inMsg.destination ||
        inMsg.dest ||
        inMsg.dst ||
        "";


      if (
        destinationFromMsg
      ) {

        try {

          const dstRaw =
            Address.parse(
              String(
                destinationFromMsg
              )
            ).toRawString();

          if (
            dstRaw !==
            treasury
          ) {
            continue;
          }

        } catch {

          // If destination is unavailable
          // in this response format,
          // the transaction is already
          // queried directly from Treasury.

        }

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


      console.log(
        "TON fee payment FOUND:",
        txHash ||
        msgHash
      );


      return {

        tx_hash:
          txHash ||
          msgHash ||
          "",

        msg_hash:
          msgHash ||
          "",

        value:
          value,

        source:
          source,

        destination:
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


  console.log(
    "TON fee payment not found yet."
  );


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


  if (
    !treasuryWallet
  ) {

    throw new Error(
      "Treasury W5 wallet is not initialized"
    );

  }


  if (
    !treasuryJettonWallet
  ) {

    throw new Error(
      "Treasury SNP Jetton Wallet is not initialized"
    );

  }


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


  console.log(
    "================================="
  );

  console.log(
    "SNP PAYOUT"
  );

  console.log(
    "Withdrawal:",
    withdrawalId
  );

  console.log(
    "Amount:",
    amount,
    "SNP"
  );

  console.log(
    "Destination:",
    destinationAddress.toString()
  );

  console.log(
    "Treasury:",
    TREASURY_WALLET
  );

  console.log(
    "Jetton wallet:",
    treasuryJettonWallet.toString()
  );

  console.log(
    "Seqno:",
    seqno
  );

  console.log(
    "Query ID:",
    queryId.toString()
  );

  console.log(
    "================================="
  );


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


  console.log(
    "SNP PAYOUT TRANSACTION SUBMITTED"
  );


  return {

    query_id:
      queryId.toString(),

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

      const amount =
        safeInt(
          req.body.amount,
          0
        );

      const requestedWallet =
        String(
          req.body.wallet_address ||
          ""
        ).trim();


      if (
        amount <= 0
      ) {

        return res.status(400)
          .json({

            error:
              "Invalid withdrawal amount"

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
        !requestedWallet ||
        requestedWallet.length < 20
      ) {

        return res.status(400)
          .json({

            error:
              "Connect your wallet first"

          });

      }


      if (
        user.wallet_address &&
        user.wallet_address !==
          requestedWallet
      ) {

        return res.status(400)
          .json({

            error:
              "Wallet does not match your connected wallet"

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

            requestedWallet,

            amount,

            "0.1",

            FEE_NANO,

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
          FEE_NANO,

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


      let current =
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


      let currentWithdrawal =
        current.rows[0];


      if (
        !currentWithdrawal
      ) {

        return res.status(404)
          .json({

            error:
              "Withdrawal not found"

          });

      }


      // --------------------------------------------------------
      // VERIFY 0.1 TON FEE
      // --------------------------------------------------------

      if (
        currentWithdrawal.status ===
        "payment_pending"
      ) {

        let feePayment =
          null;


        try {

          feePayment =
            await findFeePayment(
              currentWithdrawal
            );

        } catch (
          feeLookupError
        ) {

          console.error(
            "Fee verification lookup failed",
            feeLookupError
          );

          return res.status(503)
            .json({

              error:
                "Could not verify the TON fee yet. Please try again in a few seconds."

            });

        }


        if (
          !feePayment
        ) {

          return res.status(400)
            .json({

              error:
                "The 0.1 TON fee payment has not been confirmed yet. Please wait a few seconds and try again.",

              status:
                "payment_pending"

            });

        }


        const marked =
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

              feePayment.tx_hash ||
              feePayment.msg_hash ||
              "",

              now(),

              id,

              verified.id

            ]

          });


        if (
          !marked.rowsAffected
        ) {

          current =
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

          currentWithdrawal =
            current.rows[0];

        } else {

          currentWithdrawal = {

            ...currentWithdrawal,

            status:
              "fee_submitted",

            fee_tx_hash:
              feePayment.tx_hash ||
              feePayment.msg_hash ||
              ""

          };

        }

      }


      // --------------------------------------------------------
      // SEND SNP
      // --------------------------------------------------------

      if (
        currentWithdrawal &&
        (
          currentWithdrawal.status ===
            "fee_submitted"

          ||

          currentWithdrawal.status ===
            "fee_paid_pending_payout"
        )
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

                currentWithdrawal.wallet_address,

                Number(
                  currentWithdrawal.amount ||
                  0
                ),

                id

              );


            /*
             * IMPORTANT:
             * query_id is only a diagnostic
             * reference at this stage.
             * It is NOT claimed to be a
             * blockchain transaction hash.
             */

            await db.execute({

              sql: `
                UPDATE withdrawals
                SET
                  status = 'paid',
                  completed_at = ?,
                  payout_tx_hash = ?
                WHERE withdrawal_id = ?
                  AND telegram_id = ?
                  AND status = 'processing'
              `,

              args: [

                now(),

                `query:${payout.query_id}`,

                id,

                verified.id

              ]

            });


            console.log(
              `Withdrawal ${id} marked PAID`
            );


          } catch (
            payoutError
          ) {

            console.error(
              "SNP payout failed",
              payoutError
            );


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
          "Withdrawal verification failed"

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
// TELEGRAM WEBHOOK
// ============================================================

async function setupTelegramWebhook() {

  if (!BOT_TOKEN) {

    console.log(
      "TELEGRAM_BOT_TOKEN is missing"
    );

    return;

  }


  const webhookUrl =
    "https://sinaps-backend.onrender.com/telegram/webhook";


  try {

    const result =
      await telegramApi(

        "setWebhook",

        {
          url:
            webhookUrl
        }

      );


    console.log(
      "Telegram webhook:",
      result
    );


  } catch (error) {

    console.error(
      "Telegram webhook setup failed:",
      error
    );

  }

}


// ============================================================
// START SERVER
// ============================================================

async function start() {

  try {

    await initDB();

    await setupTelegramWebhook();


    app.listen(

      PORT,

      () => {

        console.log(
          `SINAPS backend v4.2.0 running on ${PORT}`
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
