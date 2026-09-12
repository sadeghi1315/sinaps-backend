const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {
  res.json({
    status: "online",
    project: "SINAPS",
    message: "SINAPS Backend is running 🚀"
  });
});

// ===============================
// USER
// ===============================

app.post("/api/user", async (req, res) => {
  try {
    console.log("USER REQUEST:", req.body);

    const { telegram_id, username } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        error: "telegram_id required"
      });
    }

    let { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (error) {
      console.error("USER SELECT ERROR:", error);

      return res.status(500).json({
        error: error.message
      });
    }

    if (!user) {
      const { data: newUser, error: insertError } =
        await supabase
          .from("users")
          .insert({
            telegram_id,
            username: username || null,
            balance: 0,
            energy: 1000,
            max_energy: 1000
          })
          .select()
          .single();

      if (insertError) {
        console.error(
          "USER INSERT ERROR:",
          insertError
        );

        return res.status(500).json({
          error: insertError.message
        });
      }

      user = newUser;
    }

    res.json(user);

  } catch (error) {
    console.error("USER ERROR:", error);

    res.status(500).json({
      error: error.message
    });
  }
});

// ===============================
// WALLET CONNECT
// ===============================

app.post("/api/wallet/connect", async (req, res) => {

  console.log("=================================");
  console.log("WALLET CONNECT REQUEST");
  console.log("BODY:", req.body);
  console.log("=================================");

  try {

    const {
      telegram_id,
      wallet_address
    } = req.body;

    if (!telegram_id) {

      console.error(
        "ERROR: telegram_id missing"
      );

      return res.status(400).json({
        error: "telegram_id required"
      });
    }

    if (!wallet_address) {

      console.error(
        "ERROR: wallet_address missing"
      );

      return res.status(400).json({
        error: "wallet_address required"
      });
    }

    const cleanAddress =
      String(wallet_address).trim();

    console.log(
      "Telegram ID:",
      telegram_id
    );

    console.log(
      "Wallet:",
      cleanAddress
    );

    // Check user
    const {
      data: user,
      error: userError
    } = await supabase
      .from("users")
      .select("id, telegram_id, wallet_address")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (userError) {

      console.error(
        "USER CHECK ERROR:",
        userError
      );

      return res.status(500).json({
        error:
          "User check failed",
        details:
          userError.message
      });
    }

    if (!user) {

      console.error(
        "USER NOT FOUND:",
        telegram_id
      );

      return res.status(404).json({
        error:
          "Telegram user not found"
      });
    }

    console.log(
      "USER FOUND:",
      user
    );

    // Check duplicate wallet
    const {
      data: existingWallet,
      error: walletCheckError
    } = await supabase
      .from("users")
      .select("telegram_id")
      .eq("wallet_address", cleanAddress)
      .maybeSingle();

    if (walletCheckError) {

      console.error(
        "WALLET CHECK ERROR:",
        walletCheckError
      );

      return res.status(500).json({
        error:
          "Wallet check failed",
        details:
          walletCheckError.message
      });
    }

    if (
      existingWallet &&
      String(existingWallet.telegram_id) !==
        String(telegram_id)
    ) {

      console.error(
        "WALLET ALREADY USED"
      );

      return res.status(409).json({
        error:
          "This wallet is already connected to another account"
      });
    }

    // SAVE WALLET
    const {
      data: updatedUser,
      error: updateError
    } = await supabase
      .from("users")
      .update({
        wallet_address: cleanAddress
      })
      .eq("telegram_id", telegram_id)
      .select("telegram_id, wallet_address")
      .single();

    if (updateError) {

      console.error(
        "WALLET UPDATE ERROR:",
        updateError
      );

      return res.status(500).json({
        error:
          "Wallet update failed",
        details:
          updateError.message
      });
    }

    console.log(
      "WALLET SAVED SUCCESSFULLY:",
      updatedUser
    );

    res.json({
      success: true,
      wallet_address:
        updatedUser.wallet_address
    });

  } catch (error) {

    console.error(
      "WALLET CONNECT CRITICAL ERROR:",
      error
    );

    res.status(500).json({
      error:
        "Server error",
      details:
        error.message
    });
  }
});

// ===============================
// GET WALLET
// ===============================

app.post("/api/wallet/get", async (req, res) => {

  console.log(
    "GET WALLET REQUEST:",
    req.body
  );

  try {

    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        error:
          "telegram_id required"
      });
    }

    const {
      data: user,
      error
    } = await supabase
      .from("users")
      .select("wallet_address")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (error) {

      console.error(
        "GET WALLET ERROR:",
        error
      );

      return res.status(500).json({
        error: error.message
      });
    }

    if (!user) {

      return res.status(404).json({
        error:
          "User not found"
      });
    }

    res.json({
      wallet_address:
        user.wallet_address || null
    });

  } catch (error) {

    console.error(
      "GET WALLET CRITICAL ERROR:",
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});

// ===============================
// DISCONNECT
// ===============================

app.post(
  "/api/wallet/disconnect",
  async (req, res) => {

    console.log(
      "DISCONNECT REQUEST:",
      req.body
    );

    try {

      const { telegram_id } = req.body;

      if (!telegram_id) {

        return res.status(400).json({
          error:
            "telegram_id required"
        });
      }

      const { error } =
        await supabase
          .from("users")
          .update({
            wallet_address: null
          })
          .eq(
            "telegram_id",
            telegram_id
          );

      if (error) {

        console.error(
          "DISCONNECT ERROR:",
          error
        );

        return res.status(500).json({
          error:
            error.message
        });
      }

      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "DISCONNECT CRITICAL ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// ===============================
// TAP
// ===============================

app.post("/api/tap", async (req, res) => {

  try {

    const {
      telegram_id,
      taps,
      power
    } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        error:
          "telegram_id required"
      });
    }

    const tapCount = Math.max(
      1,
      Math.min(
        Number(taps) || 1,
        100
      )
    );

    const tapPower = Math.max(
      1,
      Number(power) || 1
    );

    const {
      data: user,
      error
    } = await supabase
      .from("users")
      .select("*")
      .eq(
        "telegram_id",
        telegram_id
      )
      .maybeSingle();

    if (error || !user) {

      return res.status(404).json({
        error:
          "User not found"
      });
    }

    const availableEnergy =
      Number(user.energy) || 0;

    const actualTaps =
      Math.min(
        tapCount,
        availableEnergy
      );

    if (actualTaps <= 0) {

      return res.status(400).json({
        error:
          "No energy"
      });
    }

    const earned =
      actualTaps * tapPower;

    const newBalance =
      Number(user.balance || 0) +
      earned;

    const newEnergy =
      availableEnergy -
      actualTaps;

    const {
      data: updated,
      error: updateError
    } = await supabase
      .from("users")
      .update({
        balance:
          newBalance,

        energy:
          newEnergy,

        last_energy_update:
          new Date().toISOString()
      })
      .eq(
        "telegram_id",
        telegram_id
      )
      .select()
      .single();

    if (updateError) {

      console.error(
        "TAP UPDATE ERROR:",
        updateError
      );

      return res.status(500).json({
        error:
          updateError.message
      });
    }

    res.json(updated);

  } catch (error) {

    console.error(
      "TAP ERROR:",
      error
    );

    res.status(500).json({
      error:
        error.message
    });
  }
});

// ===============================
// SERVER
// ===============================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    "================================="
  );

  console.log(
    `SINAPS Backend running on port ${PORT}`
  );

  console.log(
    "Wallet API: READY"
  );

  console.log(
    "================================="
  );
});
