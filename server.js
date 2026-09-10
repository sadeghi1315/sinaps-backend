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

// تست Backend
app.get("/", (req, res) => {
  res.json({
    status: "online",
    project: "SINAPS",
    message: "SINAPS Backend is running 🚀"
  });
});

// دریافت یا ساخت کاربر
app.post("/api/user", async (req, res) => {
  try {
    const { telegram_id, username } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ error: "telegram_id required" });
    }

    let { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    if (!user) {
      const result = await supabase
        .from("users")
        .insert({
          telegram_id,
          username: username || null
        })
        .select()
        .single();

      if (result.error) throw result.error;

      user = result.data;
    }

    res.json(user);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// ثبت Tap
app.post("/api/tap", async (req, res) => {
  try {
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ error: "telegram_id required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("telegram_id", telegram_id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.energy <= 0) {
      return res.status(400).json({
        error: "No energy",
        balance: user.balance,
        energy: user.energy
      });
    }

    const newBalance = user.balance + 1;
    const newEnergy = user.energy - 1;

    const { data: updated, error: updateError } = await supabase
      .from("users")
      .update({
        balance: newBalance,
        energy: newEnergy
      })
      .eq("telegram_id", telegram_id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json(updated);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SINAPS Backend running on port ${PORT}`);
});
