import http from "http";
import fs from "fs";
import crypto from "crypto";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

const PORT = process.env.PORT || 8080;
const DB_FILE = "./keys.json";

// Discord setup
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // Set in Render Environment
const CUSTOMER_CHANNEL_ID = "1470650486666301443"; // Customer panel channel
const ADMIN_ROLES = ["1470621891600584744", "1470595418080546848"];
const FOUNDER_ROLES = ["1470595418080546848"];

// Load DB
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  if (!db.keys) db.keys = {};
  if (!db.users) db.users = {};
} catch {
  db = { keys: {}, users: {} };
}

// Save DB
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// Generate a random key
const generateKey = (tier = "24h") => {
  const key = "PELICAN-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  let expiry = null;
  if (tier === "24h") expiry = Date.now() + 24*60*60*1000;
  if (tier === "7d") expiry = Date.now() + 7*24*60*60*1000;
  if (tier === "30d") expiry = Date.now() + 30*24*60*60*1000;
  db.keys[key] = { assigned: false, expiry };
  saveDB();
  return key;
};

// Validate key
const validateKey = (key) => {
  const data = db.keys[key];
  if (!data) return "invalid";
  if (data.expiry && Date.now() > data.expiry) return "expired";
  if (data.assigned) return "used";
  data.assigned = true;
  saveDB();
  return "valid";
};

// HTTP server for Lua auth
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");
  const action = urlObj.searchParams.get("action");
  const tier = urlObj.searchParams.get("tier") || "24h";

  res.setHeader("Content-Type", "text/plain");

  if (action === "generate") {
    const newKey = generateKey(tier);
    return res.end(newKey);
  }

  if (!key) return res.end("Provide a key with ?key=YOUR_KEY");

  const result = validateKey(key);
  res.end(result);
});

server.listen(PORT, () => console.log(`Key server running on port ${PORT}`));

// Discord bot
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once("ready", () => console.log(`Discord bot logged in as ${client.user.tag}`));

client.on("messageCreate", async (msg) => {
  if (!msg.guild) return;
  const args = msg.content.split(" ");
  const cmd = args.shift().toLowerCase();

  const memberRoles = msg.member.roles.cache.map(r => r.id);
  const isAdmin = memberRoles.some(r => ADMIN_ROLES.includes(r));
  const isFounder = memberRoles.some(r => FOUNDER_ROLES.includes(r));

  // Admin Commands
  if (isAdmin || isFounder) {
    if (cmd === "!gen") {
      const tier = args[0] || "24h";
      const newKey = generateKey(tier);
      msg.reply(`Generated new key: \`${newKey}\``);
    }
    if (cmd === "!keysleft") {
      const remaining = Object.values(db.keys).filter(k => !k.assigned).length;
      msg.reply(`Remaining unassigned keys: **${remaining}**`);
    }
    if (cmd === "!allkeys") {
      const keys = Object.keys(db.keys).join("\n");
      msg.reply(`All keys:\n\`\`\`${keys}\`\`\``);
    }
  }
});

// Login bot
client.login(DISCORD_TOKEN);