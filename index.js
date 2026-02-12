import {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes
} from "discord.js";
import fs from "fs";
import crypto from "crypto";
import http from "http";

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 8080;

const ADMIN_ROLE_ID = "1470594684383395934";
const CUSTOMER_ROLE_ID = "1470600210597282028";
const FOUNDER_ROLE_ID = "1470595418080546848";
const DATA_FILE = "./data.json";

/* ================= DATA STORAGE ================= */
let db = { keys: {}, users: {}, blacklist: [], suggestions: [] };
if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DATA_FILE));
    } catch (e) {
        console.error("Error loading DB, starting fresh");
    }
}

const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

function getUserData(userId) {
  if (!db.users[userId])
    db.users[userId] = { hwid: null, execs: 0, key: null, expiry: null, lastHWIDReset: 0 };
  return db.users[userId];
}

/* ================= DISCORD BOT LOGIC ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ... (Your Slash Command & Button Logic remains the same as your provided code) ...
// (I am omitting the middle Discord part for brevity, but keep yours exactly as is)

/* ================= THE KEY VALIDATION API ================= */
http.createServer((req, res) => {
  // Setup JSON headers
  res.setHeader("Content-Type", "application/json");

  // Handle /validate route
  if (req.url === "/validate" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const { key, userId, hwid } = data;

        // 1. Basic Validation
        if (!key || !userId || !hwid) {
            return res.end(JSON.stringify({ valid: false, message: "Missing request parameters." }));
        }

        // 2. Key Check
        const keyData = db.keys[key];
        if (!keyData || keyData.assignedTo !== userId) {
          return res.end(JSON.stringify({ valid: false, message: "Invalid key or not assigned to you." }));
        }

        // 3. Expiry Check
        if (keyData.expiry && Date.now() > keyData.expiry) {
          return res.end(JSON.stringify({ valid: false, message: "This key has expired." }));
        }

        // 4. HWID LOCKING
        const userData = getUserData(userId);
        if (!userData.hwid) {
            // First time using the key - Lock the HWID
            userData.hwid = hwid;
            save();
        } else if (userData.hwid !== hwid) {
            // HWID does not match
            return res.end(JSON.stringify({ valid: false, message: "HWID Mismatch! Reset via Discord." }));
        }

        // 5. Success
        userData.execs = (userData.execs || 0) + 1;
        save();

        res.end(JSON.stringify({ 
            valid: true, 
            message: `Authenticated! Welcome, ${userId}.` 
        }));

      } catch (err) {
        res.end(JSON.stringify({ valid: false, message: "Server Error: Malformed JSON." }));
      }
    });
  } else {
    // Railway Health Check / Default Page
    res.end("Pinger running - API is active.");
  }
}).listen(PORT, () => {
  console.log(`API Listening on port ${PORT}`);
});

client.login(TOKEN);
