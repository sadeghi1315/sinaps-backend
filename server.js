const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@libsql/client");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

const TREASURY_WALLET =
  process.env.TREASURY_WALLET ||
  "UQDMsJu14wu-EHSjaRpufQdPb73pKVRkQvHNezgA2zF69sJX";

const SNP_CONTRACT =
  "EQAmLlerUViNn9PwFVRlR_AjDvhd5pkmeLNOu5bNDpvXV0ls";

const WITHDRAW_FEE_NANO = "100000000";

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  process.exit(1);
}

const db = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN
});

/* =========================================================
   DATABASE
========================================================= */

async function initDatabase() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL UNIQUE,
      username TEXT DEFAULT '',
      balance INTEGER NOT NULL DEFAULT 0,
      energy INTEGER NOT NULL DEFAULT 1000,
      max_energy INTEGER NOT NULL DEFAULT 1000,
      last_energy_update TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_daily_bonus TEXT,
      wallet_address TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      withdrawal_id TEXT NOT NULL UNIQUE,
      telegram_id INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      amount INTEGER NOT NULL,
      fee_ton REAL NOT NULL DEFAULT 0.1,
      fee_nano TEXT NOT NULL DEFAULT '100000000',
      treasury_wallet TEXT NOT NULL,
      token_contract TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'payment_pending',
      fee_tx_hash TEXT,
      payout_tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verified_at TEXT,
      completed_at TEXT
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS users_telegram_id_idx
    ON users (telegram_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS withdrawals_telegram_id_idx
    ON withdrawals (telegram_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS withdrawals_status_idx
    ON withdrawals (status)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS withdrawals_fee_tx_hash_idx
    ON withdrawals (fee_tx_hash)
  `);

  console.log("Database initialized");
}

/* =========================================================
   HELPERS
========================================================= */

function normalizeTelegramId(value) {
  const n = Number(value);

  if (!Number.isSafeInteger(n) || n <= 0) {
    return null;
  }

  return n;
}

function normalizeAmount(value) {
  const n = Number(value);

  if (!Number.isSafeInteger(n) || n <= 0) {
    return null;
  }

  return n;
}

function nowISO() {
  return new Date().toISOString();
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/", async (req, res) => {
  res.json({
    ok: true,
    service: "SINAPS backend",
    database: "Turso",
    status: "online"
  });
});

/* =========================================================
   USER
========================================================= */

app.post("/api/user", async (req, res) => {
  try {
    const telegramId = normalizeTelegramId(req.body.telegram_id);
    const username = String(req.body.username || "");

    if (!telegramId) {
      return res.status(400).json({
        error: "Invalid telegram_id"
      });
    }

    let result = await db.execute({
      sql: `
        SELECT *
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,
      args: [telegramId]
    });

    if (result.rows.length === 0) {
      const now = nowISO();

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
            created_at
          )
          VALUES (?, ?, 0, 1000, 1000, ?, ?)
        `,
        args: [
          telegramId,
          username,
          now,
          now
        ]
      });
    } else if (username) {
      await db.execute({
        sql: `
          UPDATE users
          SET username = ?
          WHERE telegram_id = ?
        `,
        args: [username, telegramId]
      });
    }

    result = await db.execute({
      sql: `
        SELECT *
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,
      args: [telegramId]
    });

    return res.json({
      ok: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("USER ERROR:", error);

    return res.status(500).json({
      error: "User request failed"
    });
  }
});

/* =========================================================
   WALLET CONNECT
========================================================= */

app.post("/api/wallet/connect", async (req, res) => {
  try {
    const telegramId = normalizeTelegramId(req.body.telegram_id);
    const walletAddress = String(req.body.wallet_address || "").trim();

    if (!telegramId || !walletAddress) {
      return res.status(400).json({
        error: "telegram_id and wallet_address are required"
      });
    }

    const result = await db.execute({
      sql: `
        UPDATE users
        SET wallet_address = ?
        WHERE telegram_id = ?
      `,
      args: [
        walletAddress,
        telegramId
      ]
    });

    if (result.rowsAffected === 0) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    return res.json({
      ok: true,
      wallet_address: walletAddress
    });

  } catch (error) {
    console.error("WALLET CONNECT ERROR:", error);

    return res.status(500).json({
      error: "Wallet save failed"
    });
  }
});

/* =========================================================
   WALLET GET
========================================================= */

app.post("/api/wallet/get", async (req, res) => {
  try {
    const telegramId = normalizeTelegramId(req.body.telegram_id);

    if (!telegramId) {
      return res.status(400).json({
        error: "Invalid telegram_id"
      });
    }

    const result = await db.execute({
      sql: `
        SELECT wallet_address
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,
      args: [telegramId]
    });

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    return res.json({
      ok: true,
      wallet_address: result.rows[0].wallet_address || null
    });

  } catch (error) {
    console.error("WALLET GET ERROR:", error);

    return res.status(500).json({
      error: "Wallet lookup failed"
    });
  }
});

/* =========================================================
   WALLET DISCONNECT
========================================================= */

app.post("/api/wallet/disconnect", async (req, res) => {
  try {
    const telegramId = normalizeTelegramId(req.body.telegram_id);

    if (!telegramId) {
      return res.status(400).json({
        error: "Invalid telegram_id"
      });
    }

    await db.execute({
      sql: `
        UPDATE users
        SET wallet_address = NULL
        WHERE telegram_id = ?
      `,
      args: [telegramId]
    });

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error("WALLET DISCONNECT ERROR:", error);

    return res.status(500).json({
      error: "Wallet disconnect failed"
    });
  }
});

/* =========================================================
   TAP
========================================================= */

app.post("/api/tap", async (req, res) => {
  try {
    const telegramId = normalizeTelegramId(req.body.telegram_id);

    if (!telegramId) {
      return res.status(400).json({
        error: "Invalid telegram_id"
      });
    }

    const result = await db.execute({
      sql: `
        SELECT *
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,
      args: [telegramId]
    });

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const user = result.rows[0];

    const currentEnergy = Number(user.energy || 0);
    const currentBalance = Number(user.balance || 0);

    if (currentEnergy <= 0) {
      return res.status(400).json({
        error: "Not enough energy",
        user
      });
    }

    const newBalance = currentBalance + 1;
    const newEnergy = currentEnergy - 1;

    await db.execute({
      sql: `
        UPDATE users
        SET balance = ?,
            energy = ?
        WHERE telegram_id = ?
      `,
      args: [
        newBalance,
        newEnergy,
        telegramId
      ]
    });

    const updated = await db.execute({
      sql: `
        SELECT *
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,
      args: [telegramId]
    });

    return res.json({
      ok: true,
      user: updated.rows[0]
    });

  } catch (error) {
    console.error("TAP ERROR:", error);

    return res.status(500).json({
      error: "Tap failed"
    });
  }
});

/* =========================================================
   CREATE WITHDRAWAL
========================================================= */

app.post("/api/withdraw/create", async (req, res) => {
  try {
    const telegramId = normalizeTelegramId(req.body.telegram_id);
    const walletAddress = String(req.body.wallet_address || "").trim();
    const amount = normalizeAmount(req.body.amount);

    if (!telegramId || !walletAddress || !amount) {
      return res.status(400).json({
        error: "Invalid withdrawal data"
      });
    }

    const userResult = await db.execute({
      sql: `
        SELECT *
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `,
      args: [telegramId]
    });

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const user = userResult.rows[0];

    if (
      user.wallet_address &&
      user.wallet_address !== walletAddress
    ) {
      return res.status(400).json({
        error: "Wallet does not match saved wallet"
      });
    }

    const balance = Number(user.balance || 0);

    if (amount > balance) {
      return res.status(400).json({
        error: "Insufficient SNP balance"
      });
    }

    const pending = await db.execute({
      sql: `
        SELECT withdrawal_id
        FROM withdrawals
        WHERE telegram_id = ?
        AND status IN (
          'created',
          'payment_pending',
          'verified',
          'processing'
        )
        LIMIT 1
      `,
      args: [telegramId]
    });

    if (pending.rows.length > 0) {
      return res.status(400).json({
        error: "There is already a pending withdrawal",
        withdrawal_id: pending.rows[0].withdrawal_id
      });
    }

    const withdrawalId =
      "SNP-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(4).toString("hex").toUpperCase();

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
          status
        )
        VALUES (?, ?, ?, ?, 0.1, ?, ?, ?, 'payment_pending')
      `,
      args: [
        withdrawalId,
        telegramId,
        walletAddress,
        amount,
        WITHDRAW_FEE_NANO,
        TREASURY_WALLET,
        SNP_CONTRACT
      ]
    });

    return res.json({
      ok: true,
      withdrawal_id: withdrawalId,
      amount,
      fee_ton: 0.1,
      fee_nano: WITHDRAW_FEE_NANO,
      treasury_wallet: TREASURY_WALLET,
      token_contract: SNP_CONTRACT,
      status: "payment_pending"
    });

  } catch (error) {
    console.error("WITHDRAW CREATE ERROR:", error);

    return res.status(500).json({
      error: "Withdrawal creation failed"
    });
  }
});

/* =========================================================
   WITHDRAW STATUS
========================================================= */

app.get("/api/withdraw/status/:withdrawalId", async (req, res) => {
  try {
    const withdrawalId = String(
      req.params.withdrawalId || ""
    ).trim();

    if (!withdrawalId) {
      return res.status(400).json({
        error: "Invalid withdrawal ID"
      });
    }

    const result = await db.execute({
      sql: `
        SELECT *
        FROM withdrawals
        WHERE withdrawal_id = ?
        LIMIT 1
      `,
      args: [withdrawalId]
    });

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Withdrawal not found"
      });
    }

    return res.json({
      ok: true,
      withdrawal: result.rows[0]
    });

  } catch (error) {
    console.error("WITHDRAW STATUS ERROR:", error);

    return res.status(500).json({
      error: "Withdrawal status failed"
    });
  }
});

/* =========================================================
   VERIFY WITHDRAWAL
========================================================= */

/*
  مرحله فعلی فقط برداشت را ثبت می‌کند.
  انتقال واقعی SNP از Treasury در مرحله بعد اضافه می‌شود.

  فعلاً verify فقط وضعیت درخواست را بررسی می‌کند.
*/

app.post("/api/withdraw/verify", async (req, res) => {
  try {
    const telegramId = normalizeTelegramId(req.body.telegram_id);
    const withdrawalId = String(
      req.body.withdrawal_id || ""
    ).trim();

    const walletAddress = String(
      req.body.wallet_address || ""
    ).trim();

    if (!telegramId || !withdrawalId || !walletAddress) {
      return res.status(400).json({
        error: "Invalid verification data"
      });
    }

    const result = await db.execute({
      sql: `
        SELECT *
        FROM withdrawals
        WHERE withdrawal_id = ?
        LIMIT 1
      `,
      args: [withdrawalId]
    });

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Withdrawal not found"
      });
    }

    const withdrawal = result.rows[0];

    if (Number(withdrawal.telegram_id) !== telegramId) {
      return res.status(403).json({
        error: "Telegram user mismatch"
      });
    }

    if (withdrawal.wallet_address !== walletAddress) {
      return res.status(403).json({
        error: "Wallet mismatch"
      });
    }

    if (withdrawal.status === "completed") {
      return res.json({
        ok: true,
        status: "completed",
        withdrawal
      });
    }

    /*
      هنوز پرداخت TON روی زنجیره تأیید نشده است.
      این مرحله عمداً فقط وضعیت را نگه می‌دارد.
    */

    return res.json({
      ok: true,
      status: withdrawal.status,
      withdrawal
    });

  } catch (error) {
    console.error("WITHDRAW VERIFY ERROR:", error);

    return res.status(500).json({
      error: "Withdrawal verification failed"
    });
  }
});

/* =========================================================
   START
========================================================= */

async function start() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `SINAPS backend running on port ${PORT}`
      );
    });

  } catch (error) {
    console.error("STARTUP ERROR:", error);
    process.exit(1);
  }
}

start();
