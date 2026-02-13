import http from "http";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;

// In-memory key database
let db = {
  keys: {}, // key -> {expiry: timestamp|null, assigned: boolean}
};

// Generate a test key automatically
const generateTestKey = (tier = "24h") => {
  const key = "TEST-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  let expiry = null;

  if (tier === "24h") expiry = Date.now() + 24 * 60 * 60 * 1000;

  db.keys[key] = { assigned: false, expiry };
  console.log("Test Key Generated:", key);
  return key;
};

// Create test key on startup
generateTestKey();

// Validation function
const validateKey = (key) => {
  const kData = db.keys[key];
  if (!kData) return "invalid";
  if (kData.expiry && Date.now() > kData.expiry) return "expired";
  if (kData.assigned) return "used";

  kData.assigned = true;
  return "valid";
};

// HTTP server
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");

  res.setHeader("Content-Type", "text/plain");

  if (!key) {
    return res.end("Provide a key with ?key=YOUR_KEY");
  }

  const result = validateKey(key);
  res.end(result);
});

server.listen(PORT, () => {
  console.log(`Key server running on port ${PORT}`);
});
