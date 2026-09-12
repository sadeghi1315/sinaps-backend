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
      console.error("User select error:", error);

      return res.status(500).json({
        error: "Failed to load user",
        details: error.message
      });
    }

    // Create user if not exists
    if (!user) {
      const { data: newUser, error: insertError } =
        await supabase
          .from("users")
          .insert({
            telegram_id: telegram_id,
            username: username || null,
            balance: 0,
            energy: 1000,
            max_energy: 1000
          })
          .select()
          .single();

      if (insertError) {
        console.error("User insert error:", insertError);

        return res.status(500).json({
          error: "Failed to create user",
          details: insertError.message
        });
      }

      user = newUser;
    }

    res.json(user);

  } catch (error) {
    console.error("USER API ERROR:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

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
        error: "telegram_id required"
      });
    }

    const tapCount = Math.max(
      1,
      Math.min(Number(taps) || 1, 100)
    );

    const tapPower = Math.max(
      1,
      Number(power) || 1
    );

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .maybeSingle();

    if (error) {
      console.error("Tap user error:", error);

      return res.status(500).json({
        error: "Failed to load user"
      });
    }

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const availableEnergy =
      Number(user.energy) || 0;

    const actualTaps = Math.min(
      tapCount,
      availableEnergy
    );

    if (actualTaps <= 0) {
      return res.status(400).json({
        error: "No energy",
        balance: Number(user.balance) || 0,
        energy: availableEnergy,
        max_energy: Number(user.max_energy) || 1000
      });
    }

    const earned =
      actualTaps * tapPower;

    const newBalance =
      (Number(user.balance) || 0) + earned;

    const newEnergy =
      availableEnergy - actualTaps;

    const { data: updated, error: updateError } =
      await supabase
        .from("users")
        .update({
          balance: newBalance,
          energy: newEnergy,
          last_energy_update: new Date().toISOString()
        })
        .eq("telegram_id", telegram_id)
        .select()
        .single();

    if (updateError) {
      console.error("Tap update error:", updateError);

      return res.status(500).json({
        error: "Failed to update balance",
        details: updateError.message
      });
    }

    res.json(updated);

  } catch (error) {
    console.error("TAP API ERROR:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// ===============================
// WALLET CONNECT
// ===============================

app.post("/api/wallet/connect", async (req, res) => {
  try {
    const {
      telegram_id,
      wallet_address
    } = req.body;

    if (!telegram_id || !wallet_address) {
      return res.status(400).json({
        error: "telegram_id and wallet_address required"
      });
    }

    const cleanAddress =
      String(wallet_address).trim();

    if (cleanAddress.length < 20) {
      return res.status(400).json({
        error: "Invalid wallet address"
      });
    }

    // Check if wallet is already connected
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
        "Wallet check error:",
        walletCheckError
      );

      return res.status(500).json({
        error: "Wallet check failed",
        details: walletCheckError.message
      });
    }

    // Wallet belongs to another account
    if (
      existingWallet &&
      String(existingWallet.telegram_id) !==
        String(telegram_id)
    ) {
      return res.status(409).json({
        error:
          "This wallet is already connected to another account"
      });
    }

    // Save wallet
    const {
      data: updatedUser,
      error: updateError
    } = await supabase
      .from("users")
      .update({
        wallet_address: cleanAddress
      })
      .eq("telegram_id", telegram_id)
      .select()
      .single();

    if (updateError) {
      console.error(
        "Wallet save error:",
        updateError
      );

      return res.status(500).json({
        error: "Failed to save wallet",
        details: updateError.message
      });
    }

    res.json({
      success: true,
      wallet_address:
        updatedUser.wallet_address
    });

  } catch (error) {
    console.error(
      "WALLET CONNECT ERROR:",
      error
    );

    res.status(500).json({
      error: "Server error"
    });
  }
});

// ===============================
// GET SAVED WALLET
// ===============================

app.post("/api/wallet/get", async (req, res) => {
  try {
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        error: "telegram_id required"
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
        "Get wallet error:",
        error
      );

      return res.status(500).json({
        error: "Failed to load wallet",
        details: error.message
      });
    }

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    res.json({
      wallet_address:
        user.wallet_address || null
    });

  } catch (error) {
    console.error(
      "GET WALLET ERROR:",
      error
    );

    res.status(500).json({
      error: "Server error"
    });
  }
});

// ===============================
// DISCONNECT WALLET
// ===============================

app.post("/api/wallet/disconnect", async (req, res) => {
  try {
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({
        error: "telegram_id required"
      });
    }

    const { error } = await supabase
      .from("users")
      .update({
        wallet_address: null
      })
      .eq("telegram_id", telegram_id);

    if (error) {
      console.error(
        "Wallet disconnect error:",
        error
      );

      return res.status(500).json({
        error: "Failed to disconnect wallet",
        details: error.message
      });
    }

    res.json({
      success: true
    });

  } catch (error) {
    console.error(
      "DISCONNECT WALLET ERROR:",
      error
    );

    res.status(500).json({
      error: "Server error"
    });
  }
});

// ===============================
// START SERVER
// ===============================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `SINAPS Backend running on port ${PORT}`
  );
});
