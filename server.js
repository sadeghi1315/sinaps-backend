"use strict";

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { createClient } =
  require("@supabase/supabase-js");


const app =
  express();


/* =========================
   CONFIG
========================= */

const PORT =
  process.env.PORT || 10000;


const SUPABASE_URL =
  process.env.SUPABASE_URL;


const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


const TONAPI_KEY =
  process.env.TONAPI_KEY || "";


const TREASURY_WALLET =
  "UQDMsJu14wu-EHSjaRpufQdPb73pKVRkQvHNezgA2zF69sJX";


const SNP_CONTRACT =
  "EQAmLlerUViNn9PwFVRlR_AjDvhd5pkmeLNOu5bNDpvXV0ls";


const WITHDRAW_FEE_NANO =
  "100000000";


const WITHDRAW_FEE_TON =
  0.1;


const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );


/* =========================
   MIDDLEWARE
========================= */

app.use(
  cors({
    origin: "*"
  })
);


app.use(
  express.json({
    limit: "1mb"
  })
);


/* =========================
   HEALTH
========================= */

app.get(
  "/",
  function (req, res) {

    res.json({
      status: "online",
      service: "SINAPS backend",
      network: "TON mainnet",
      token: SNP_CONTRACT
    });

  }
);


/* =========================
   USER
========================= */

app.post(
  "/api/user",
  async function (req, res) {

    try {

      const {
        telegram_id,
        username
      } = req.body;


      if (!telegram_id) {

        return res
          .status(400)
          .json({
            message:
              "telegram_id required"
          });

      }


      const tgId =
        Number(telegram_id);


      if (!Number.isFinite(tgId)) {

        return res
          .status(400)
          .json({
            message:
              "Invalid telegram_id"
          });

      }


      const { data: existing } =
        await supabase
          .from("users")
          .select("*")
          .eq(
            "telegram_id",
            tgId
          )
          .maybeSingle();


      if (existing) {

        return res.json({
          user: existing
        });

      }


      const { data: created, error } =
        await supabase
          .from("users")
          .insert({

            telegram_id:
              tgId,

            username:
              username || "",

            balance:
              0,

            energy:
              1000,

            max_energy:
              1000

          })
          .select()
          .single();


      if (error) {

        console.error(
          "Create user:",
          error
        );

        return res
          .status(500)
          .json({
            message:
              "Could not create user"
          });

      }


      return res.json({
        user: created
      });


    } catch (error) {

      console.error(error);

      return res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   WALLET CONNECT
========================= */

app.post(
  "/api/wallet/connect",
  async function (req, res) {

    try {

      const {
        telegram_id,
        wallet_address
      } = req.body;


      if (
        !telegram_id ||
        !wallet_address
      ) {

        return res
          .status(400)
          .json({
            message:
              "telegram_id and wallet_address required"
          });

      }


      const { data, error } =
        await supabase
          .from("users")
          .update({

            wallet_address:
              wallet_address

          })
          .eq(
            "telegram_id",
            Number(telegram_id)
          )
          .select()
          .single();


      if (error) {

        console.error(error);

        return res
          .status(500)
          .json({
            message:
              "Could not save wallet"
          });

      }


      res.json({
        success: true,
        user: data
      });


    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   WALLET GET
========================= */

app.post(
  "/api/wallet/get",
  async function (req, res) {

    try {

      const {
        telegram_id
      } = req.body;


      if (!telegram_id) {

        return res
          .status(400)
          .json({
            message:
              "telegram_id required"
          });

      }


      const { data, error } =
        await supabase
          .from("users")
          .select(
            "wallet_address"
          )
          .eq(
            "telegram_id",
            Number(telegram_id)
          )
          .maybeSingle();


      if (error) {

        return res
          .status(500)
          .json({
            message:
              "Database error"
          });

      }


      res.json({
        wallet_address:
          data
            ? data.wallet_address
            : null
      });


    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   WALLET DISCONNECT
========================= */

app.post(
  "/api/wallet/disconnect",
  async function (req, res) {

    try {

      const {
        telegram_id
      } = req.body;


      await supabase
        .from("users")
        .update({
          wallet_address:
            null
        })
        .eq(
          "telegram_id",
          Number(telegram_id)
        );


      res.json({
        success: true
      });


    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   TAP
========================= */

app.post(
  "/api/tap",
  async function (req, res) {

    try {

      const {
        telegram_id
      } = req.body;


      if (!telegram_id) {

        return res
          .status(400)
          .json({
            message:
              "telegram_id required"
          });

      }


      const id =
        Number(telegram_id);


      const { data: user } =
        await supabase
          .from("users")
          .select("*")
          .eq(
            "telegram_id",
            id
          )
          .maybeSingle();


      if (!user) {

        return res
          .status(404)
          .json({
            message:
              "User not found"
          });

      }


      const currentEnergy =
        Number(user.energy || 0);


      if (currentEnergy <= 0) {

        return res.json({
          user
        });

      }


      const newBalance =
        Number(user.balance || 0) + 1;


      const newEnergy =
        currentEnergy - 1;


      const { data, error } =
        await supabase
          .from("users")
          .update({

            balance:
              newBalance,

            energy:
              newEnergy

          })
          .eq(
            "telegram_id",
            id
          )
          .select()
          .single();


      if (error) {

        console.error(error);

        return res
          .status(500)
          .json({
            message:
              "Tap update failed"
          });

      }


      res.json({
        user: data
      });


    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   WITHDRAW CREATE
========================= */

app.post(
  "/api/withdraw/create",
  async function (req, res) {

    try {

      const {
        telegram_id,
        wallet_address,
        amount
      } = req.body;


      const tgId =
        Number(telegram_id);


      const withdrawAmount =
        Number(amount);


      if (
        !Number.isFinite(tgId) ||
        !wallet_address ||
        !Number.isFinite(withdrawAmount)
      ) {

        return res
          .status(400)
          .json({
            message:
              "Invalid withdrawal data"
          });

      }


      if (
        !Number.isInteger(
          withdrawAmount
        ) ||
        withdrawAmount <= 0
      ) {

        return res
          .status(400)
          .json({
            message:
              "Invalid SNP amount"
          });

      }


      /*
       * Check user
       */

      const { data: user, error: userError } =
        await supabase
          .from("users")
          .select("*")
          .eq(
            "telegram_id",
            tgId
          )
          .maybeSingle();


      if (userError) {

        console.error(
          userError
        );

        return res
          .status(500)
          .json({
            message:
              "Database error"
          });

      }


      if (!user) {

        return res
          .status(404)
          .json({
            message:
              "User not found"
          });

      }


      /*
       * Wallet must match saved wallet.
       */

      if (
        user.wallet_address &&
        user.wallet_address !==
          wallet_address
      ) {

        return res
          .status(400)
          .json({
            message:
              "Wallet does not match your connected wallet."
          });

      }


      /*
       * Check balance.
       */

      const userBalance =
        Number(
          user.balance || 0
        );


      if (
        withdrawAmount >
        userBalance
      ) {

        return res
          .status(400)
          .json({
            message:
              "Insufficient SNP balance."
          });

      }


      /*
       * Prevent multiple pending withdrawals.
       */

      const {
        data: pending
      } =
        await supabase
          .from("withdrawals")
          .select("id")
          .eq(
            "telegram_id",
            tgId
          )
          .in(
            "status",
            [
              "created",
              "payment_pending",
              "verified",
              "processing"
            ]
          )
          .limit(1);


      if (
        pending &&
        pending.length > 0
      ) {

        return res
          .status(409)
          .json({
            message:
              "You already have a pending withdrawal."
          });

      }


      /*
       * Create unique withdrawal ID.
       */

      const withdrawalId =
        crypto
          .randomBytes(16)
          .toString("hex");


      /*
       * Reserve SNP immediately.
       *
       * IMPORTANT:
       * This version does NOT permanently
       * burn or transfer SNP.
       * It only records the request.
       */

      const { data: withdrawal, error } =
        await supabase
          .from("withdrawals")
          .insert({

            withdrawal_id:
              withdrawalId,

            telegram_id:
              tgId,

            wallet_address:
              wallet_address,

            amount:
              withdrawAmount,

            fee_ton:
              WITHDRAW_FEE_TON,

            fee_nano:
              WITHDRAW_FEE_NANO,

            treasury_wallet:
              TREASURY_WALLET,

            token_contract:
              SNP_CONTRACT,

            status:
              "payment_pending"

          })
          .select()
          .single();


      if (error) {

        console.error(
          "Create withdrawal:",
          error
        );

        return res
          .status(500)
          .json({
            message:
              "Could not create withdrawal."
          });

      }


      res.json({

        success: true,

        withdrawal_id:
          withdrawalId,

        amount:
          withdrawAmount,

        fee_ton:
          WITHDRAW_FEE_TON,

        treasury_wallet:
          TREASURY_WALLET,

        status:
          "payment_pending"

      });


    } catch (error) {

      console.error(
        "Withdraw create error:",
        error
      );

      res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   TONAPI HELPERS
========================= */

async function getTreasuryTransactions() {

  const url =
    "https://tonapi.io/v2/blockchain/accounts/" +
    encodeURIComponent(
      TREASURY_WALLET
    ) +
    "/transactions?limit=20";


  const headers = {};


  if (TONAPI_KEY) {

    headers.Authorization =
      "Bearer " +
      TONAPI_KEY;

  }


  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: headers
      }
    );


  if (!response.ok) {

    const text =
      await response.text();

    throw new Error(
      "TONAPI HTTP " +
      response.status +
      ": " +
      text
    );

  }


  return response.json();

}


/*
 * Find an incoming TON transfer
 * to treasury from user's wallet.
 *
 * We intentionally require:
 *
 * 1. correct sender
 * 2. correct treasury
 * 3. exactly 0.1 TON
 * 4. recent transaction
 */

async function findFeePayment(
  walletAddress,
  createdAt
) {

  const result =
    await getTreasuryTransactions();


  const transactions =
    result.transactions ||
    [];


  const minimumTime =
    Math.floor(
      new Date(createdAt).getTime()
      / 1000
    ) - 120;


  const maximumTime =
    Math.floor(
      Date.now() / 1000
    ) + 120;


  for (
    const tx of transactions
  ) {

    const txTime =
      Number(
        tx.utime ||
        tx.now ||
        0
      );


    if (
      txTime &&
      (
        txTime <
        minimumTime ||
        txTime >
        maximumTime
      )
    ) {
      continue;
    }


    /*
     * Inspect incoming messages.
     */

    const inMsg =
      tx.in_msg;


    if (!inMsg) continue;


    const value =
      String(
        inMsg.value ||
        "0"
      );


    if (
      value !==
      WITHDRAW_FEE_NANO
    ) {
      continue;
    }


    const source =
      inMsg.source ||
      inMsg.sender ||
      "";


    const destination =
      inMsg.destination ||
      inMsg.dest ||
      "";


    if (
      source &&
      source !==
        walletAddress
    ) {
      continue;
    }


    if (
      destination &&
      destination !==
        TREASURY_WALLET
    ) {
      continue;
    }


    return tx;

  }


  return null;

}


/* =========================
   WITHDRAW VERIFY
========================= */

app.post(
  "/api/withdraw/verify",
  async function (req, res) {

    try {

      const {
        withdrawal_id,
        telegram_id,
        wallet_address
      } = req.body;


      if (
        !withdrawal_id ||
        !telegram_id ||
        !wallet_address
      ) {

        return res
          .status(400)
          .json({
            message:
              "Missing withdrawal data."
          });

      }


      const {
        data: withdrawal,
        error
      } =
        await supabase
          .from("withdrawals")
          .select("*")
          .eq(
            "withdrawal_id",
            withdrawal_id
          )
          .maybeSingle();


      if (error) {

        console.error(error);

        return res
          .status(500)
          .json({
            message:
              "Database error."
          });

      }


      if (!withdrawal) {

        return res
          .status(404)
          .json({
            message:
              "Withdrawal not found."
          });

      }


      if (
        Number(
          withdrawal.telegram_id
        ) !==
        Number(telegram_id)
      ) {

        return res
          .status(403)
          .json({
            message:
              "Withdrawal ownership mismatch."
          });

      }


      if (
        withdrawal.wallet_address !==
        wallet_address
      ) {

        return res
          .status(403)
          .json({
            message:
              "Wallet mismatch."
          });

      }


      /*
       * Already verified.
       */

      if (
        withdrawal.status ===
        "verified"
      ) {

        return res.json({
          success: true,
          status: "verified",
          message:
            "Payment already verified."
        });

      }


      /*
       * Query blockchain.
       */

      let transaction;


      try {

        transaction =
          await findFeePayment(
            wallet_address,
            withdrawal.created_at
          );

      } catch (e) {

        console.error(
          "TONAPI error:",
          e
        );

        return res
          .status(503)
          .json({
            message:
              "Blockchain verification temporarily unavailable. Try again."
          });

      }


      if (!transaction) {

        return res
          .status(400)
          .json({
            message:
              "0.1 TON payment was not found yet. Wait a few seconds and try again."
          });

      }


      /*
       * Extract transaction identifier.
       */

      const txHash =
        transaction.hash ||
        transaction.transaction_id?.hash ||
        null;


      /*
       * Mark verified.
       */

      const {
        data: updated,
        error: updateError
      } =
        await supabase
          .from("withdrawals")
          .update({

            status:
              "verified",

            fee_tx_hash:
              txHash,

            verified_at:
              new Date().toISOString()

          })
          .eq(
            "withdrawal_id",
            withdrawal_id
          )
          .select()
          .single();


      if (updateError) {

        console.error(
          updateError
        );

        return res
          .status(500)
          .json({
            message:
              "Could not update withdrawal."
          });

      }


      res.json({

        success: true,

        status:
          "verified",

        withdrawal:
          updated,

        message:
          "0.1 TON payment verified. SNP withdrawal is now pending treasury processing."

      });


    } catch (error) {

      console.error(
        "Withdraw verify:",
        error
      );

      res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   WITHDRAW STATUS
========================= */

app.get(
  "/api/withdraw/status/:id",
  async function (req, res) {

    try {

      const id =
        req.params.id;


      const {
        data,
        error
      } =
        await supabase
          .from("withdrawals")
          .select("*")
          .eq(
            "withdrawal_id",
            id
          )
          .maybeSingle();


      if (error) {

        return res
          .status(500)
          .json({
            message:
              "Database error."
          });

      }


      if (!data) {

        return res
          .status(404)
          .json({
            message:
              "Withdrawal not found."
          });

      }


      res.json({
        success: true,
        withdrawal: data
      });


    } catch (error) {

      console.error(error);

      res
        .status(500)
        .json({
          message:
            "Server error"
        });

    }

  }
);


/* =========================
   SERVER
========================= */

app.listen(
  PORT,
  function () {

    console.log(
      "SINAPS backend running on port " +
      PORT
    );

    console.log(
      "SNP contract:",
      SNP_CONTRACT
    );

    console.log(
      "Treasury:",
      TREASURY_WALLET
    );

  }
);
