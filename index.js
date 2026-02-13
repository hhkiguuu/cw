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
import fetch from "node-fetch"; // For fetching server keys

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1470594684383395934";
const FOUNDER_ROLE_ID = "1470595418080546848";
const CUSTOMER_ROLE_ID = "YOUR_CUSTOMER_ROLE_ID";

const PORT = process.env.PORT || 8080;
const DATA_FILE = "./data.json";

/* ================= STORAGE ================= */
let db = { keys: {}, users: {}, blacklist: [] };
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));

const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const getUserData = (userId) => {
  if (!db.users[userId]) {
    db.users[userId] = { key: null, expiry: null, hwid: null, ip: null, execs: 0, violations: 0, lastHWIDReset: 0 };
  }
  return db.users[userId];
};

/* ================= SERVER KEY GENERATION ================= */
const generateServerKeys = () => {
  for (let i = 0; i < 150; i++) {
    const key = "PELICAN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    if (!db.keys[key]) db.keys[key] = { assignedTo: null, expiry: Date.now() + 24*60*60*1000, hwid: null, ip: null, violations: 0 };
  }
  save();
};
generateServerKeys();

/* ================= VALIDATION FOR LUA ================= */
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
http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const q = parsed.query;

  res.setHeader("Content-Type", "text/plain");

  if (q.verify && q.key && q.hwid && q.ip) {
    const result = validateKey(q.key, q.hwid, q.ip);
    return res.end(result.valid ? "valid" : result.reason);
  }

  if (q.getKey && q.userId) {
    const key = Object.entries(db.keys).find(([k, v]) => !v.assignedTo);
    if (key) {
      const [k, v] = key;
      v.assignedTo = q.userId;
      getUserData(q.userId).key = k;
      getUserData(q.userId).expiry = v.expiry;
      save();
      return res.end(k);
    } else return res.end("none");
  }

  res.end("Key server running");
}).listen(PORT, () => console.log(`Key server running on port ${PORT}`));

/* ================= DISCORD BOT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], partials: [Partials.Channel] });
const hasRole = (member, roleId) => member.roles.cache.has(roleId);

const buildCustomerPanel = () => new EmbedBuilder()
  .setTitle("🔷 Pelican Control Panel 🔷")
  .setColor("Blue")
  .setDescription(`Welcome to SyncWare, a free script hub with optional premium keys.

Buttons explained:
🔹 Get Script
🔹 Redeem Key
🔹 Reset HWID
🔹 Get Stats

Premium keys are optional but unlock more power.
👉 Get keys here: https://discord.gg/2MjA42jhsy`);

const buildAdminPanelEmbed = () => new EmbedBuilder()
  .setTitle("🔧 Admin Panel")
  .setColor("Red")
  .setDescription("Admin commands for key management.");

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);
  const isAdmin = interaction.member && (hasRole(interaction.member, ADMIN_ROLE_ID) || hasRole(interaction.member, FOUNDER_ROLE_ID));

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
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("genKey").setLabel("Generate Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("revokeKey").setLabel("Revoke Key").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("extendKey").setLabel("Extend Key").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("viewKeys").setLabel("View Keys").setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [buildAdminPanelEmbed()], components: [row], ephemeral: false });
    }
  }

  if (interaction.isButton()) {
    // Customer restrictions
    if (["getScript","getStats","selfResetHWID"].includes(interaction.customId) && (!userData.key || !interaction.member.roles.cache.has(CUSTOMER_ROLE_ID))) {
      return interaction.reply({ content: "❌ You need an active key and Customer role.", ephemeral: true });
    }

    // Admin restrictions
    if (["genKey","revokeKey","extendKey","viewKeys"].includes(interaction.customId) && !isAdmin) {
      return interaction.reply({ content: "❌ Admins only.", ephemeral: true });
    }

    // Admin buttons
    if (interaction.customId === "genKey") {
      const res = await fetch(`http://localhost:${PORT}/?getKey=1&userId=${userId}`);
      const newKey = await res.text();
      await interaction.user.send(`Your new key: ${newKey}`);
      return interaction.reply({ content: "Key sent via DM!", ephemeral: true });
    }
  }
});

/* ================= REGISTER COMMANDS ================= */
client.once("ready", async () => {
  console.log("Bot Ready");
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Open panel")
      .addStringOption(o =>
        o.setName("type")
          .setDescription("Panel type")
          .setRequired(true)
          .addChoices({ name: "admin", value: "admin" }, { name: "customer", value: "customer" })
      )
  ];

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

client.login(TOKEN);

/* ================= EXPORT VALIDATE FUNCTION ================= */
export { validateKey };
