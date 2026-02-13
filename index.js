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
import url from "url";

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1470594684383395934";
const FOUNDER_ROLE_ID = "1470595418080546848";
const CUSTOMER_ROLE_ID = "1470600210597282028";

const DATA_FILE = "./data.json";
const PORT = process.env.PORT || 8080;

/* ================= STORAGE ================= */
let db = { keys: {}, users: {}, blacklist: [] };
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));

const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const getUserData = (userId) => {
  if (!db.users[userId]) {
    db.users[userId] = {
      key: null,
      expiry: null,
      hwid: null,
      ip: null,
      execs: 0,
      violations: 0
    };
  }
  return db.users[userId];
};

/* ================= KEY GENERATION ================= */
const generateKeys = (amount = 150) => {
  for (let i = 0; i < amount; i++) {
    const key = "PELICAN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    if (!db.keys[key]) {
      db.keys[key] = {
        assignedTo: null,
        expiry: Date.now() + 24 * 60 * 60 * 1000, // 24h expiry
        hwid: null,
        ip: null,
        violations: 0
      };
    }
  }
  save();
};
generateKeys(); // generate 150 keys on startup

/* ================= VALIDATION ================= */
const validateKey = (key, hwid, ip) => {
  const kData = db.keys[key];
  if (!kData) return { valid: false, reason: "invalid" };
  if (kData.expiry && Date.now() > kData.expiry) return { valid: false, reason: "expired" };
  if (!kData.assignedTo) return { valid: false, reason: "not redeemed" };

  const user = getUserData(kData.assignedTo);

  if (!user.hwid) user.hwid = hwid;
  if (!user.ip) user.ip = ip;

  if (user.hwid !== hwid || user.ip !== ip) {
    user.violations++;
    if (user.violations >= 3) {
      db.blacklist.push(kData.assignedTo);
      save();
      return { valid: false, reason: "blacklisted" };
    }
    save();
    return { valid: false, reason: "used" };
  }

  user.execs++;
  save();
  return { valid: true };
};

/* ================= HTTP SERVER ================= */
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const q = parsed.query;

  res.setHeader("Content-Type", "text/plain");

  // Verification from Lua
  if (q.verify && q.key && q.hwid && q.ip) {
    const result = validateKey(q.key, q.hwid, q.ip);
    return res.end(result.valid ? "valid" : result.reason);
  }

  // Give key to Discord bot
  if (q.getKey && q.userId) {
    const userId = q.userId;

    // Find first unused key
    const key = Object.keys(db.keys).find(k => !db.keys[k].assignedTo);
    if (!key) return res.end("none");

    // Assign to user
    db.keys[key].assignedTo = userId;
    db.keys[key].expiry = Date.now() + 24 * 60 * 60 * 1000; // 24h
    save();

    return res.end(key);
  }

  res.end("Key server running");
});

server.listen(PORT, () => console.log(`Key server running on port ${PORT}`));

/* ================= DISCORD BOT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const hasRole = (member, roleId) => member.roles.cache.has(roleId);

/* ================= CUSTOMER PANEL ================= */
const buildCustomerPanel = () => new EmbedBuilder()
  .setTitle("🔷 Pelican Control Panel 🔷")
  .setColor("Blue")
  .setDescription(`Welcome to SyncWare, a free script hub with optional premium keys.

Buttons:

🔹 Get Script - Fetch your personal script (requires active key)
🔹 Redeem Key - Redeem a purchased key
🔹 Reset HWID - Reset hardware ID (requires active key)
🔹 Get Stats - View key info (requires active key)

Premium keys are optional but unlock more power.
👉 Get keys here: <#1470650486666301443>`);

/* ================= BOT INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);

  const activeKey = userData.key && db.keys[userData.key] && (!db.keys[userData.key].expiry || Date.now() < db.keys[userData.key].expiry);
  const isAdmin = interaction.member && (hasRole(interaction.member, ADMIN_ROLE_ID) || hasRole(interaction.member, FOUNDER_ROLE_ID));

  /* Slash commands */
  if (interaction.isChatInputCommand()) {
    const type = interaction.options.getString("type");

    if (type === "customer") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("getScript").setLabel("Get Script").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("redeemKey").setLabel("Redeem Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("selfResetHWID").setLabel("Reset HWID").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("getStats").setLabel("Get Stats").setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({ embeds: [buildCustomerPanel()], components: [row], ephemeral: false });
    }

    if (type === "admin" && isAdmin) {
      // Admin commands will be separate slash commands
      return interaction.reply({ content: "Admin commands available via /gen, /revoke, /extend, /viewkeys", ephemeral: true });
    }
  }

  /* BUTTONS */
  if (interaction.isButton()) {
    if (!activeKey && interaction.customId !== "redeemKey") {
      return interaction.reply({ content: "❌ You do not have an active key.", ephemeral: true });
    }

    if (interaction.customId === "redeemKey") {
      const modal = new ModalBuilder().setCustomId("redeemModal").setTitle("Redeem Key");
      const input = new TextInputBuilder().setCustomId("keyInput").setLabel("Enter your key").setStyle(TextInputStyle.Short);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "getScript") {
      if (!activeKey) return interaction.reply({ content: "❌ You need an active key.", ephemeral: true });
      return interaction.reply({ content: `Here is your script: https://pastebin.com/raw/micAhK9e?key=${userData.key}`, ephemeral: true });
    }

    if (interaction.customId === "getStats") {
      if (!activeKey) return interaction.reply({ content: "❌ You need an active key.", ephemeral: true });
      const keyInfo = db.keys[userData.key];
      return interaction.reply({ content: `Key: ${userData.key}\nExpiry: ${new Date(keyInfo.expiry)}\nExecutions: ${userData.execs}\nHWID: ${keyInfo.hwid || "Not set"}\nIP: ${keyInfo.ip || "Not set"}`, ephemeral: true });
    }

    if (interaction.customId === "selfResetHWID") {
      if (!activeKey) return interaction.reply({ content: "❌ You need an active key.", ephemeral: true });
      userData.hwid = null;
      save();
      return interaction.reply({ content: "✅ HWID reset. Next use will set new HWID.", ephemeral: true });
    }
  }

  /* MODALS */
  if (interaction.isModalSubmit() && interaction.customId === "redeemModal") {
    const key = interaction.fields.getTextInputValue("keyInput").trim();
    const kData = db.keys[key];

    if (!kData) return interaction.reply({ content: "Invalid key.", ephemeral: true });
    if (kData.expiry && Date.now() > kData.expiry) return interaction.reply({ content: "Key expired.", ephemeral: true });
    if (kData.assignedTo) return interaction.reply({ content: "Key already redeemed.", ephemeral: true });

    kData.assignedTo = userId;
    userData.key = key;
    userData.expiry = kData.expiry;
    save();

    return interaction.reply({ content: "Key redeemed successfully!", ephemeral: true });
  }
});

/* ================= ADMIN SLASH COMMANDS ================= */
client.once("ready", async () => {
  console.log("Bot Ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const commands = [
    new SlashCommandBuilder().setName("setup")
      .setDescription("Open panel")
      .addStringOption(o =>
        o.setName("type")
          .setDescription("Panel type")
          .setRequired(true)
          .addChoices(
            { name: "admin", value: "admin" },
            { name: "customer", value: "customer" }
          )
      ),
    new SlashCommandBuilder().setName("gen")
      .setDescription("Generate a key and DM it to yourself")
      .addUserOption(o => o.setName("user").setDescription("User to generate for").setRequired(false)),
    new SlashCommandBuilder().setName("viewkeys").setDescription("View all keys"),
    new SlashCommandBuilder().setName("revoke").setDescription("Revoke a key").addStringOption(o => o.setName("key").setDescription("Key to revoke").setRequired(true))
  ];

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

client.login(TOKEN);
