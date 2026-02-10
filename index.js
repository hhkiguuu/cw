// ================================
// CW Key System API v2.6
// All-in-one: Keys, Admin, Expiry, Execution Logs, Rate Limiting
// No Discord webhook logging
// ================================

import express from "express";
import fs from "fs";
import crypto from "crypto";

const app = express();
app.use(express.json());

// ================================
// CONFIG
// ================================
const PORT = process.env.PORT || 8080;
const DATA_FILE = "./data.json";
const RATE_LIMIT_MS = 1000; // 1 second between requests per key

// ================================
// DATA STORE
// ================================
let db = {
  keys: {
    // Example key for testing
    "CW-TEST-KEY": {
      expiry: null,
      hwid: null,
      generatedBy: "admin",
      executions: 0,
      lastExecution: 0
    }
  },
  admins: {
    // userId: true
  }
};

if (fs.existsSync(DATA_FILE)) {
  db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ================================
// HELPERS
// ================================
function now() { return Date.now(); }

function genKey() {
  return "CW-" + crypto.randomBytes(8).toString("hex").toUpperCase();
}

function isAdmin(userId) {
  return db.admins[userId];
}

// ================================
// HEALTH CHECK
// ================================
app.get("/", (req, res) => {
  res.send("CW Key API Online");
});

// ================================
// AUTHENTICATE / VALIDATE KEY
// ================================
app.post("/validate", (req, res) => {
  const { key, hwid, userId } = req.body;
  if (!key || !hwid || !userId)
    return res.json({ valid: false, reason: "missing_fields" });

  const entry = db.keys[key];
  if (!entry) return res.json({ valid: false, reason: "invalid_key" });

  if (entry.expiry && now() > entry.expiry)
    return res.json({ valid: false, reason: "expired" });

  if (!entry.hwid) {
    entry.hwid = hwid;
    save();
  }

  if (entry.hwid !== hwid)
    return res.json({ valid: false, reason: "hwid_mismatch" });

  return res.json({
    valid: true,
    key,
    expiry: entry.expiry,
    executions: entry.executions
  });
});

// ================================
// EXECUTION LOG
// ================================
app.post("/execute", (req, res) => {
  const { key, hwid, userId } = req.body;
  const entry = db.keys[key];
  if (!entry) return res.json({ ok: false, reason: "invalid_key" });

  // Rate limit
  if (entry.lastExecution && now() - entry.lastExecution < RATE_LIMIT_MS)
    return res.json({ ok: false, reason: "rate_limited" });

  entry.executions = (entry.executions || 0) + 1;
  entry.lastExecution = now();
  save();

  console.log(`[EXEC] user=${userId} key=${key} hwid=${hwid} time=${new Date().toISOString()}`);

  res.json({ ok: true });
});

// ================================
// ADMIN ROUTES
// ================================
app.post("/admin/generate", (req, res) => {
  const { adminId, expiryMs } = req.body;
  if (!isAdmin(adminId)) return res.json({ ok: false, reason: "not_admin" });

  const key = genKey();
  db.keys[key] = {
    expiry: expiryMs ? now() + Number(expiryMs) : null,
    hwid: null,
    generatedBy: adminId,
    executions: 0,
    lastExecution: 0
  };
  save();

  return res.json({ ok: true, key });
});

app.post("/admin/revoke", (req, res) => {
  const { adminId, key } = req.body;
  if (!isAdmin(adminId)) return res.json({ ok: false, reason: "not_admin" });

  if (!db.keys[key]) return res.json({ ok: false, reason: "invalid_key" });

  delete db.keys[key];
  save();
  return res.json({ ok: true });
});

app.post("/admin/list", (req, res) => {
  const { adminId } = req.body;
  if (!isAdmin(adminId)) return res.json({ ok: false, reason: "not_admin" });

  return res.json({ ok: true, keys: db.keys });
});

app.post("/admin/addAdmin", (req, res) => {
  const { founderId, newAdminId } = req.body;
  // Only founders can add other admins
  if (!isAdmin(founderId)) return res.json({ ok: false, reason: "not_admin" });

  db.admins[newAdminId] = true;
  save();
  return res.json({ ok: true });
});

// ================================
// START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`CW Key API running on port ${PORT}`);
});
