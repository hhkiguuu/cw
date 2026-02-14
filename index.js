import http from "http";
import fs from "fs";
import crypto from "crypto";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from "discord.js";

const PORT = process.env.PORT || 8080;
const DB_FILE = "./keys.json"; // Persist keys across restarts

// Discord setup
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // Bot token
const CLIENT_ID = process.env.CLIENT_ID; // Your bot application ID
const GUILD_ID = process.env.GUILD_ID; // Optional: limit to one server
const ADMIN_CHANNEL_ID = "1470650486666301443"; // Admin logs channel

// Load or initialize database
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  if (!db.keys) db.keys = {};
  if (!db.users) db.users = {}; // key -> userID
  if (!db.hwids) db.hwids = {}; // key -> hwid
} catch {
  db = { keys: {}, users: {}, hwids: {} };
}

// Save database helper
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// Generate new key
const generateKey = (tier = "1d") => {
  const key = "PELICAN-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  let expiry = null;
  if (tier === "1d") expiry = Date.now() + 24 * 60 * 60 * 1000;
  if (tier === "7d") expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  if (tier === "30d") expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
  db.keys[key] = { assigned: false, expiry };
  saveDB();
  return key;
};

// Validate key
const validateKey = (key, hwid) => {
  const data = db.keys[key];
  if (!data) return "invalid";
  if (data.expiry && Date.now() > data.expiry) return "expired";
  if (data.assigned) return "used";
  if (db.hwids[key] && db.hwids[key] !== hwid) return "hwid_mismatch"; // anti-key share
  data.assigned = true;
  db.hwids[key] = hwid;
  saveDB();
  return "valid";
};

// HTTP server for Lua loader
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");
  const hwid = urlObj.searchParams.get("hwid") || "none";
  const action = urlObj.searchParams.get("action");
  const tier = urlObj.searchParams.get("tier") || "1d";

  res.setHeader("Content-Type", "text/plain");

  if (action === "generate") {
    const newKey = generateKey(tier);
    return res.end(newKey);
  }

  if (!key) return res.end("Provide a key with ?key=YOUR_KEY");

  const result = validateKey(key, hwid);
  res.end(result);
});

server.listen(PORT, () => console.log(`Key server running on port ${PORT}`));

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("gen")
    .setDescription("Generate a new key")
    .addStringOption(opt => opt.setName("tier").setDescription("Key tier").setRequired(false)),
  new SlashCommandBuilder()
    .setName("genprekey")
    .setDescription("Give a pre-generated key from keys.json"),
  new SlashCommandBuilder()
    .setName("keysleft")
    .setDescription("Check remaining unassigned keys"),
  new SlashCommandBuilder()
    .setName("allkeys")
    .setDescription("List all keys"),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Show customer panel embed"),
  new SlashCommandBuilder()
    .setName("forcehwid")
    .setDescription("Force reset HWID for a user")
    .addStringOption(opt => opt.setName("key").setDescription("Key to reset").setRequired(true))
];

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log("Refreshing slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Slash commands registered.");
  } catch (err) {
    console.error(err);
  }
})();

// Discord ready
client.once("ready", () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

// Admin and customer roles
const ADMIN_ROLES = ["1470621891600584744", "1470595418080546848"]; // Founder & Admin
const CUSTOMER_ROLE = "1470600210597282028"; // Customer role

// Slash command handling
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild } = interaction;
  const memberRoles = member.roles.cache.map(r => r.id);
  const isAdmin = memberRoles.some(r => ADMIN_ROLES.includes(r));
  const isCustomer = memberRoles.includes(CUSTOMER_ROLE);

  // Admin commands
  if (commandName === "gen") {
    if (!isAdmin) return interaction.reply({ content: "You do not have permission.", ephemeral: true });
    const tier = options.getString("tier") || "1d";
    const newKey = generateKey(tier);
    interaction.reply({ content: `Generated new key: \`${newKey}\`` });
  }

  if (commandName === "genprekey") {
    if (!isAdmin) return interaction.reply({ content: "You do not have permission.", ephemeral: true });
    const available = Object.keys(db.keys).filter(k => !db.keys[k].assigned);
    if (available.length === 0) return interaction.reply({ content: "No available keys.", ephemeral: true });
    const key = available[Math.floor(Math.random() * available.length)];
    db.keys[key].assigned = true;
    saveDB();
    interaction.reply({ content: `Pre-generated key: \`${key}\`` });
  }

  if (commandName === "keysleft") {
    const remaining = Object.values(db.keys).filter(k => !k.assigned).length;
    interaction.reply({ content: `Remaining unassigned keys: **${remaining}**` });
  }

  if (commandName === "allkeys") {
    const keys = Object.keys(db.keys).join("\n");
    interaction.reply({ content: `All keys:\n\`\`\`${keys}\`\`\`` });
  }

  if (commandName === "panel") {
    const embed = new EmbedBuilder()
      .setTitle("Customer Panel")
      .setDescription(
        `**Claim your key:** Use \`/genprekey\` or wait for admin.\n` +
        `**Stats / Reset / HWID / Get Script:** Only customers with <@&${CUSTOMER_ROLE}> can access.\n` +
        `**Discord:** [Join Server](https://discord.gg/qUcj2GmeJv)`
      )
      .setColor(0x1ABC9C);
    interaction.reply({ embeds: [embed] });
  }

  if (commandName === "forcehwid") {
    if (!isAdmin) return interaction.reply({ content: "You do not have permission.", ephemeral: true });
    const key = options.getString("key");
    if (!db.hwids[key]) return interaction.reply({ content: "Key not found.", ephemeral: true });
    delete db.hwids[key];
    saveDB();
    interaction.reply({ content: `HWID for \`${key}\` has been reset.` });
  }
});

client.login(DISCORD_TOKEN);