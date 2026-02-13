import http from "http";
import fs from "fs";
import crypto from "crypto";
import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";

// ---------------------------
// Configuration
// ---------------------------
const PORT = process.env.PORT || 8080;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "MTQ3MDYxMDEyNTk1Njk3MjYyNQ.GsGnPP.EaWFTpXuyKjFoMDKsbjFWhVBFzSZ_b-KzMDC8Q";
const DISCORD_CHANNEL_ID = "1470650486666301443"; // channel for logs
const ROLES = {
  founder: "1470595418080546848",
  admin: "1470621891600584744",
  customer: "1470600210597282028"
};

// ---------------------------
// Database (keys)
// ---------------------------
const DB_FILE = "./keys.json";
let db;

try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  if (!db || typeof db !== "object") db = { keys: {} };
  if (!db.keys || typeof db.keys !== "object") db.keys = {};
} catch {
  db = { keys: {} };
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ---------------------------
// Key Generation
// ---------------------------
const generateKeys = (count = 10, prefix = "PELICAN", tier = "24h") => {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = `${prefix}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    let expiry = null;
    if (tier === "24h") expiry = Date.now() + 24 * 60 * 60 * 1000;
    if (tier === "7d") expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (tier === "30d") expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

    db.keys[key] = { assigned: false, expiry };
    keys.push(key);
  }
  saveDB();
  return keys;
};

// Auto-generate initial keys if empty
if (Object.keys(db.keys).length === 0) {
  generateKeys(50, "PELICAN", "24h");
  generateKeys(30, "PELICAN", "7d");
  generateKeys(20, "PELICAN", "30d");
  console.log("Initial keys generated and saved.");
}

// ---------------------------
// HTTP Key Verification Server
// ---------------------------
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");

  res.setHeader("Content-Type", "text/plain");

  if (!key) return res.end("Provide a key with ?key=YOUR_KEY");

  const kData = db.keys[key];
  if (!kData) return res.end("invalid");
  if (kData.expiry && Date.now() > kData.expiry) return res.end("expired");
  if (kData.assigned) return res.end("used");

  kData.assigned = true;
  saveDB();
  res.end("valid");
});

server.listen(PORT, () => console.log(`HTTP Key Server running on port ${PORT}`));

// ---------------------------
// Discord Bot
// ---------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.on("ready", async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const memberRoles = interaction.member.roles;
  const command = interaction.commandName;

  // Admin commands
  if (command === "gen") {
    if (!memberRoles.cache.has(ROLES.admin) && !memberRoles.cache.has(ROLES.founder)) {
      return interaction.reply({ content: "You do not have admin permissions.", ephemeral: true });
    }

    // Pull a random unassigned key
    const availableKeys = Object.entries(db.keys).filter(([k, v]) => !v.assigned);
    if (availableKeys.length === 0) return interaction.reply({ content: "No keys available!", ephemeral: true });

    const [key] = availableKeys[Math.floor(Math.random() * availableKeys.length)];
    db.keys[key].assigned = true;
    saveDB();

    await interaction.reply({ content: `Generated key: \`${key}\``, ephemeral: true });
  }

  if (command === "checkkeys") {
    if (!memberRoles.cache.has(ROLES.admin) && !memberRoles.cache.has(ROLES.founder)) {
      return interaction.reply({ content: "You do not have admin permissions.", ephemeral: true });
    }

    const available = Object.values(db.keys).filter(k => !k.assigned).length;
    interaction.reply({ content: `Available keys: ${available}`, ephemeral: true });
  }

  // Customer panel (embed example)
  if (command === "panel") {
    if (!memberRoles.cache.has(ROLES.customer)) {
      return interaction.reply({ content: "You are not a customer!", ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle("Customer Panel")
      .setDescription(`Use your commands here.\nJoin our Discord: https://discord.gg/qUcj2GmeJv`)
      .setColor(0x00ff00);

    interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(DISCORD_TOKEN);
