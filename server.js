const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-Telegram-Init-Data"
  ]
}));

app.use(
  express.json({
    limit: "1mb"
  })
);


const PORT =
  process.env.PORT || 10000;

const DB_URL =
  process.env.TURSO_DATABASE_URL;

const DB_TOKEN =
  process.env.TURSO_AUTH_TOKEN;

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;


const TREASURY_WALLET =
  process.env.TREASURY_WALLET ||
  "UQDMsJu14wu-EHSjaRpufQdPb73pKVRkQvHNezgA2zF69sJX";


const SNP_CONTRACT =
  process.env.SNP_CONTRACT ||
  "EQAmLlerUViNn9PwFVRlR_AjDvhd5pkmeLNOu5bNDpvXV0ls";


const TONCENTER =
  process.env.TONCENTER_API ||
  "https://toncenter.com/api/v3";


const FEE_NANO =
  "100000000";


const ENERGY_REGEN_SECONDS =
  3;


const REFERRAL_RATE =
  0.15;


if (!DB_URL || !DB_TOKEN) {

  console.error(
    "Missing Turso environment variables"
  );

  process.exit(1);
}


const db =
  createClient({
    url: DB_URL,
    authToken: DB_TOKEN
  });


// ============================================================
// BOOST CONFIG
// ============================================================

const BOOSTS = {

  tap2: {
    id: "tap2",
    type: "tap",
    level: 2,
    name: "Tap ×2",
    description: "2 SNP per tap",
    price: 200,
    icon: "⚡"
  },

  tap3: {
    id: "tap3",
    type: "tap",
    level: 3,
    name: "Tap ×3",
    description: "3 SNP per tap",
    price: 300,
    icon: "⚡"
  },

  tap4: {
    id: "tap4",
    type: "tap",
    level: 4,
    name: "Tap ×4",
    description: "4 SNP per tap",
    price: 500,
    icon: "⚡"
  },

  tap5: {
    id: "tap5",
    type: "tap",
    level: 5,
    name: "Tap ×5",
    description: "5 SNP per tap",
    price: 800,
    icon: "⚡"
  },


  energy2: {
    id: "energy2",
    type: "energy",
    level: 2,
    name: "Energy ×2",
    description: "Maximum 2,000 energy",
    price: 200,
    icon: "🔋"
  },

  energy3: {
    id: "energy3",
    type: "energy",
    level: 3,
    name: "Energy ×3",
    description: "Maximum 3,000 energy",
    price: 350,
    icon: "🔋"
  },

  energy4: {
    id: "energy4",
    type: "energy",
    level: 4,
    name: "Energy ×4",
    description: "Maximum 4,000 energy",
    price: 600,
    icon: "🔋"
  },

  energy5: {
    id: "energy5",
    type: "energy",
    level: 5,
    name: "Energy ×5",
    description: "Maximum 5,000 energy",
    price: 1000,
    icon: "🔋"
  },


  recharge2: {
    id: "recharge2",
    type: "recharge",
    level: 2,
    name: "Recharge ×2",
    description: "2× faster",
    price: 150,
    icon: "🚀"
  },

  recharge3: {
    id: "recharge3",
    type: "recharge",
    level: 3,
    name: "Recharge ×3",
    description: "3× faster",
    price: 300,
    icon: "🚀"
  },

  recharge5: {
    id: "recharge5",
    type: "recharge",
    level: 5,
    name: "Recharge ×5",
    description: "5× faster",
    price: 600,
    icon: "🚀"
  }

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
    id: "twitter",
    name: "Follow SINAPS on X",
    reward: 50,
    icon: "𝕏",
    url: "https://x.com/SINAPS_SNP",
    type: "twitter"
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
// HELPERS
// ============================================================

function now() {
  return new Date().toISOString();
}


function randomCode() {

  return crypto
    .randomBytes(8)
    .toString("hex")
    .slice(0, 8)
    .toUpperCase();
}


function parseTime(value) {

  if (!value) {
    return Date.now();
  }

  let s =
    String(value);

  if (
    !s.endsWith("Z") &&
    !/[+-]\d\d:\d\d$/.test(s)
  ) {

    s =
      s.replace(" ", "T") +
      "Z";
  }

  const time =
    Date.parse(s);

  return Number.isFinite(time)
    ? time
    : Date.now();
}


// ============================================================
// TELEGRAM AUTH
// ============================================================

function verifyTelegram(
  initData
) {

  if (
    !initData ||
    !BOT_TOKEN
  ) {

    return null;
  }


  try {

    const params =
      new URLSearchParams(
        initData
      );


    const hash =
      params.get("hash");


    if (!hash) {
      return null;
    }


    const authDate =
      Number(
        params.get("auth_date")
      );


    if (!authDate) {
      return null;
    }


    if (
      Math.abs(
        Math.floor(
          Date.now() / 1000
        ) -
        authDate
      ) >
      86400
    ) {

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
          ([key, value]) =>
            `${key}=${value}`
        )
        .join("\n");


    const secret =
      crypto
        .createHmac(
          "sha256",
          "WebAppData"
        )
        .update(
          BOT_TOKEN
        )
        .digest();


    const calculated =
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(
          dataCheckString
        )
        .digest("hex");


    if (
      calculated.length !==
      hash.length
    ) {

      return null;
    }


    if (
      !crypto.timingSafeEqual(
        Buffer.from(calculated),
        Buffer.from(hash)
      )
    ) {

      return null;
    }


    const userRaw =
      params.get("user");


    if (!userRaw) {
      return null;
    }


    const user =
      JSON.parse(
        userRaw
      );


    if (!user?.id) {
      return null;
    }


    return {
      id: String(user.id),
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


// ============================================================
// USER HELPERS
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


function publicUser(
  user
) {

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
      Number(user.max_energy || 1000),

    tap_power:
      Number(user.tap_power || 1),

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
      ""

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
// ENERGY SYNC
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
    Number(
      user.max_energy || 1000
    );


  const energy =
    Number(
      user.energy || 0
    );


  const multiplier =
    Number(
      user.recharge_multiplier || 1
    );


  const last =
    parseTime(
      user.last_energy_update
    );


  const elapsed =
    Math.max(
      0,
      Date.now() - last
    );


  const interval =
    (
      ENERGY_REGEN_SECONDS *
      1000
    ) /
    Math.max(
      1,
      multiplier
    );


  const gained =
    Math.floor(
      elapsed / interval
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
// DATABASE
// ============================================================

async function ensureColumn(
  table,
  column,
  definition
) {

  const result =
    await db.execute(
      `PRAGMA table_info(${table})`
    );


  const exists =
    result.rows.some(
      row =>
        String(row.name) ===
        column
    );


  if (!exists) {

    await db.execute(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}


async function initDB() {

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

      wallet_address TEXT

    )
  `);


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

      claimed_at TEXT

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


  await ensureColumn(
    "users",
    "tap_power",
    "INTEGER DEFAULT 1"
  );


  await ensureColumn(
    "users",
    "tap_boost_level",
    "INTEGER DEFAULT 1"
  );


  await ensureColumn(
    "users",
    "energy_boost_level",
    "INTEGER DEFAULT 1"
  );


  await ensureColumn(
    "users",
    "recharge_multiplier",
    "INTEGER DEFAULT 1"
  );


  await ensureColumn(
    "users",
    "recharge_level",
    "INTEGER DEFAULT 1"
  );


  console.log(
    "Database ready"
  );
}


// ============================================================
// ROOT
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.json({
      project: "SINAPS",
      status: "online",
      version: "3.0.0"
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
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Telegram authentication required"
          });
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
        ).trim();


      let user =
        await getUser(
          telegramId
        );


      if (!user) {

        let referralCode =
          randomCode();


        let referralExists =
          await db.execute({
            sql: `
              SELECT telegram_id
              FROM users
              WHERE referral_code = ?
            `,
            args: [
              referralCode
            ]
          });


        while (
          referralExists.rows.length
        ) {

          referralCode =
            randomCode();


          referralExists =
            await db.execute({
              sql: `
                SELECT telegram_id
                FROM users
                WHERE referral_code = ?
              `,
              args: [
                referralCode
              ]
            });
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
            ) !== telegramId
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
              daily_streak,
              referral_code,
              referred_by,
              tap_power,
              tap_boost_level,
              energy_boost_level,
              recharge_multiplier,
              recharge_level
            )
            VALUES
            (
              ?, ?, 0, 1000, 1000,
              ?, ?, 0, ?, ?,
              1, 1, 1, 1, 1
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


        if (referredBy) {

          await db.execute({
            sql: `
              UPDATE users
              SET balance =
                balance + 100
              WHERE telegram_id = ?
            `,
            args: [
              referredBy
            ]
          });


          await addTransaction(
            referredBy,
            "REFERRAL",
            100,
            "Completed",
            "New SINAPS referral"
          );
        }


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
        ok: true,
        user:
          publicUser(user)
      });


    } catch (error) {

      console.error(
        "/api/user",
        error
      );


      res
        .status(500)
        .json({
          error:
            "Failed to load user"
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
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const telegramId =
        verified.id;


      const user =
        await syncEnergy(
          telegramId
        );


      if (!user) {

        return res
          .status(404)
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
            Math.floor(
              Number(
                req.body.count || 1
              )
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

        return res
          .status(400)
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


      const newEnergy =
        energy -
        usable;


      await db.execute({
        sql: `
          UPDATE users
          SET
            balance =
              balance + ?,

            energy = ?,

            last_energy_update = ?

          WHERE telegram_id = ?
            AND energy >= ?
        `,
        args: [
          reward,
          newEnergy,
          now(),
          telegramId,
          usable
        ]
      });


      const updated =
        await getUser(
          telegramId
        );


      res.json({
        ok: true,
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


      res
        .status(500)
        .json({
          error:
            "Tap failed"
        });
    }
  }
);


// ============================================================
// BOOSTS
// ============================================================

app.get(
  "/api/boosts",
  async (req, res) => {

    try {

      const verified =
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const user =
        await syncEnergy(
          verified.id
        );


      const tapLevel =
        Number(
          user.tap_boost_level || 1
        );


      const energyLevel =
        Number(
          user.energy_boost_level || 1
        );


      const rechargeLevel =
        Number(
          user.recharge_level || 1
        );


      const boosts =
        Object.values(
          BOOSTS
        ).map(
          boost => {

            let current =
              1;


            if (
              boost.type === "tap"
            ) {
              current =
                tapLevel;
            }


            if (
              boost.type === "energy"
            ) {
              current =
                energyLevel;
            }


            if (
              boost.type === "recharge"
            ) {
              current =
                rechargeLevel;
            }


            return {

              ...boost,

              current_level:
                current,

              owned:
                current >=
                boost.level

            };
          }
        );


      res.json({
        ok: true,
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


      res
        .status(500)
        .json({
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
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const telegramId =
        verified.id;


      const boost =
        BOOSTS[
          String(
            req.body.boost_id ||
            ""
          )
        ];


      if (!boost) {

        return res
          .status(400)
          .json({
            error:
              "Invalid boost"
          });
      }


      const user =
        await syncEnergy(
          telegramId
        );


      const current =
        boost.type === "tap"
          ? Number(
              user.tap_boost_level || 1
            )
          : boost.type === "energy"
            ? Number(
                user.energy_boost_level || 1
              )
            : Number(
                user.recharge_level || 1
              );


      if (
        current >=
        boost.level
      ) {

        return res
          .status(400)
          .json({
            error:
              "Boost already active"
          });
      }


      if (
        boost.level >
        current + 1
      ) {

        return res
          .status(400)
          .json({
            error:
              "Buy the previous level first"
          });
      }


      const deducted =
        await db.execute({
          sql: `
            UPDATE users
            SET balance =
              balance - ?
            WHERE telegram_id = ?
              AND balance >= ?
          `,
          args: [
            boost.price,
            telegramId,
            boost.price
          ]
        });


      if (
        !deducted.rowsAffected
      ) {

        return res
          .status(400)
          .json({
            error:
              "Not enough SNP"
          });
      }


      if (
        boost.type === "tap"
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
            boost.level,
            boost.level,
            telegramId
          ]
        });
      }


      if (
        boost.type === "energy"
      ) {

        const oldMax =
          Number(
            user.max_energy || 1000
          );


        const newMax =
          boost.level *
          1000;


        const energy =
          Number(
            user.energy || 0
          );


        const newEnergy =
          Math.min(
            newMax,
            energy +
            Math.max(
              0,
              newMax - oldMax
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
            boost.level,
            telegramId
          ]
        });
      }


      if (
        boost.type === "recharge"
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
            boost.level,
            boost.level,
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
          boost.id,
          boost.type,
          boost.level,
          boost.price,
          now()
        ]
      });


      await addTransaction(
        telegramId,
        "BOOST",
        -boost.price,
        "Completed",
        `Purchased ${boost.name}`
      );


      const updated =
        await getUser(
          telegramId
        );


      res.json({

        ok: true,

        message:
          `${boost.name} activated`,

        user:
          publicUser(updated)

      });


    } catch (error) {

      console.error(
        "/api/boosts/buy",
        error
      );


      res
        .status(500)
        .json({
          error:
            "Boost purchase failed"
        });
    }
  }
);


// ============================================================
// DAILY STATUS
// ============================================================

function dateOnly(
  date = new Date()
) {

  return date
    .toISOString()
    .slice(0, 10);
}


function dayDifference(
  oldDate,
  newDate
) {

  const a =
    new Date(
      `${oldDate}T00:00:00Z`
    );


  const b =
    new Date(
      `${newDate}T00:00:00Z`
    );


  return Math.round(
    Math.abs(
      b - a
    ) /
    86400000
  );
}


app.get(
  "/api/daily/status",
  async (req, res) => {

    try {

      const verified =
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const user =
        await getUser(
          verified.id
        );


      const today =
        dateOnly();


      const last =
        user.last_daily_bonus
          ? String(
              user.last_daily_bonus
            ).slice(0, 10)
          : null;


      const claimedToday =
        last === today;


      let nextDay =
        1;


      if (claimedToday) {

        nextDay =
          Number(
            user.daily_streak || 1
          );

      } else if (
        last &&
        dayDifference(
          last,
          today
        ) === 1
      ) {

        nextDay =
          Number(
            user.daily_streak || 0
          ) + 1;

      }


      if (
        nextDay > 30
      ) {
        nextDay = 1;
      }


      let claimedDays = [];


      if (
        claimedToday ||
        (
          last &&
          dayDifference(
            last,
            today
          ) === 1
        )
      ) {

        const streak =
          Number(
            user.daily_streak || 0
          );


        if (
          streak > 0
        ) {

          for (
            let i = 1;
            i <= streak;
            i++
          ) {

            claimedDays.push(
              i
            );
          }
        }
      }


      res.json({

        ok: true,

        claimedToday,

        currentDay:
          Number(
            user.daily_streak || 0
          ),

        nextDay,

        reward:
          nextDay * 10,

        claimedDays

      });


    } catch (error) {

      console.error(
        "/api/daily/status",
        error
      );


      res
        .status(500)
        .json({
          error:
            "Daily status failed"
        });
    }
  }
);


// ============================================================
// DAILY CLAIM
// ============================================================

app.post(
  "/api/daily/claim",
  async (req, res) => {

    try {

      const verified =
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const telegramId =
        verified.id;


      const user =
        await getUser(
          telegramId
        );


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

        return res
          .status(400)
          .json({
            error:
              "Daily reward already claimed"
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
            user.daily_streak || 0
          ) + 1;
      }


      if (
        day > 30
      ) {
        day = 1;
      }


      const reward =
        day * 10;


      await db.execute({
        sql: `
          UPDATE users
          SET
            balance =
              balance + ?,

            daily_streak = ?,

            last_daily_bonus = ?

          WHERE telegram_id = ?
        `,
        args: [
          reward,
          day,
          today,
          telegramId
        ]
      });


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


      const updated =
        await getUser(
          telegramId
        );


      res.json({

        ok: true,

        day,

        reward,

        balance:
          Number(
            updated.balance || 0
          )

      });


    } catch (error) {

      console.error(
        "/api/daily/claim",
        error
      );


      res
        .status(500)
        .json({
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
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const wallet =
        String(
          req.body.wallet_address ||
          ""
        ).trim();


      if (
        wallet.length < 20
      ) {

        return res
          .status(400)
          .json({
            error:
              "Invalid wallet"
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


      res.json({

        ok: true,

        wallet_address:
          wallet

      });


    } catch (error) {

      console.error(
        "/api/wallet/connect",
        error
      );


      res
        .status(500)
        .json({
          error:
            "Wallet save failed"
        });
    }
  }
);


app.post(
  "/api/wallet/get",
  async (req, res) => {

    try {

      const verified =
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const user =
        await getUser(
          verified.id
        );


      res.json({

        ok: true,

        wallet_address:
          user?.wallet_address ||
          null

      });


    } catch (error) {

      res
        .status(500)
        .json({
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
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
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
            row =>
              String(
                row.task_id
              )
          )
        );


      res.json({

        ok: true,

        tasks:
          TASKS.map(
            task => ({
              ...task,
              completed:
                claimed.has(
                  task.id
                )
            })
          )

      });


    } catch (error) {

      res
        .status(500)
        .json({
          error:
            "Tasks failed"
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
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
      }


      const user =
        await getUser(
          verified.id
        );


      const result =
        await db.execute({
          sql: `
            SELECT
              telegram_id,
              username,
              created_at
            FROM users
            WHERE referred_by = ?
            ORDER BY created_at DESC
          `,
          args: [
            verified.id
          ]
        });


      res.json({

        ok: true,

        referral_code:
          user?.referral_code ||
          "",

        referral_link:
          `https://t.me/SNPCOINBot?startapp=${user?.referral_code || ""}`,

        friends:
          result.rows

      });


    } catch (error) {

      res
        .status(500)
        .json({
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
        auth(req);


      if (!verified?.id) {

        return res
          .status(401)
          .json({
            error:
              "Unauthorized"
          });
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

        ok: true,

        history:
          result.rows

      });


    } catch (error) {

      res
        .status(500)
        .json({
          error:
            "History failed"
        });
    }
  }
);


// ============================================================
// START SERVER
// ============================================================

async function start() {

  try {

    await initDB();


    app.listen(
      PORT,
      () => {

        console.log(
          `SINAPS backend running on ${PORT}`
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
