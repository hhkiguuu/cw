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
const HWID_RESET_COOLDOWN = 24 * 60 * 60 * 1000;
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
      violations: 0,
      lastHWIDReset: 0
    };
  }
  return db.users[userId];
};

/* ================= KEY FUNCTIONS ================= */
const genKey = (tier = "30d") => {
  const key = "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  let expiry = null;
  if (tier === "7d") expiry = Date.now() + 7 * 86400000;
  if (tier === "30d") expiry = Date.now() + 30 * 86400000;
  if (tier === "lifetime") expiry = null;

  db.keys[key] = { assignedTo: null, expiry, tier, used: false, hwid: null, ip: null, violations: 0 };
  save();
  return key;
};

/* ================= VALIDATION (FOR LUA SCRIPT) ================= */
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

/* ================= CLEANUP ================= */
const cleanupExpiredKeys = async (client) => {
  const guild = await client.guilds.fetch(GUILD_ID);

  for (const [key, data] of Object.entries(db.keys)) {
    if (data.expiry && Date.now() > data.expiry) {
      if (data.assignedTo) {
        const user = getUserData(data.assignedTo);
        user.key = null;
        user.expiry = null;

        const member = await guild.members.fetch(data.assignedTo).catch(() => null);
        if (member) await member.roles.remove(CUSTOMER_ROLE_ID).catch(() => null);
      }
      delete db.keys[key];
    }
  }
  save();
};

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const hasRole = (member, roleId) => member.roles.cache.has(roleId);

/* ================= CUSTOMER PANEL EMBED ================= */
const buildCustomerPanel = () => {
  return new EmbedBuilder()
    .setTitle(" **Pelican Control Panel**\n🔷 Pelican Control Panel 🔷")
    .setColor("Blue")
    .setDescription(`Welcome to Pelican, a free script hub with optional premium keys.
We support many games and most executors.

Buttons explained:

🔹 Get Script
Get your personal script with your key already attached.

🔹 Redeem Key
Redeem a purchased key to unlock premium features.

🔹 Reset HWID
Reset your hardware ID if you changed PC or executor.

🔹 Get Stats
View key info, status, expiration, and other details.

Premium keys are optional but unlock more power.
👉 Buy keys here: <#1470650486666301443>`);
};

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);

  const activeKey =
    interaction.member &&
    interaction.member.roles.cache.has(CUSTOMER_ROLE_ID);

  const isAdmin =
    interaction.member &&
    (hasRole(interaction.member, ADMIN_ROLE_ID) ||
      hasRole(interaction.member, FOUNDER_ROLE_ID));

  /* COMMANDS */
  if (interaction.isChatInputCommand()) {
    const type = interaction.options.getString("type");

    if (type === "customer") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("getScript").setLabel("Get Script").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("redeemKey").setLabel("Redeem Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("selfResetHWID").setLabel("Reset HWID").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("getStats").setLabel("Get Stats").setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({
        embeds: [buildCustomerPanel()],
        components: [row],
        ephemeral: false
      });
    }

    if (type === "admin") {
      if (!isAdmin) return interaction.reply({ content: "❌ You are not an admin.", ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("genKey").setLabel("Generate Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("revokeKey").setLabel("Revoke Key").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("extendKey").setLabel("Extend Key").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("viewKeys").setLabel("View Keys").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("viewViolations").setLabel("View Violations").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("resetHWID").setLabel("Reset HWID").setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({
        content: "Admin Panel",
        components: [row],
        ephemeral: false
      });
    }
  }

  /* BUTTON RESTRICTIONS */
  if (interaction.isButton()) {
    if (!activeKey && !isAdmin && interaction.customId !== "redeemKey") {
      return interaction.reply({
        content: "❌ You do not have an active key.",
        ephemeral: true
      });
    }
  }

  /* HANDLE REDEEM / ADMIN MODALS */
  // ... paste the modal submission logic from previous admin panel code here (genKeyModal, revokeKeyModal, extendKeyModal, resetHWIDModal, redeemModal)
});

/* ================= HTTP SERVER FOR LUA ================= */
http
  .createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query;

    res.setHeader("Content-Type", "text/plain");

    if (q.verify && q.key && q.hwid && q.ip) {
      const result = validateKey(q.key, q.hwid, q.ip);
      return res.end(result.valid ? "valid" : result.reason);
    }

    res.end("Key server running");
  })
  .listen(PORT, () => console.log(`Key server running on port ${PORT}`));

/* ================= START BOT ================= */
client.once("ready", async () => {
  console.log("Bot Ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Open panel")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Panel type")
          .setRequired(true)
          .addChoices(
            { name: "admin", value: "admin" },
            { name: "customer", value: "customer" }
          )
      )
  ];

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  // Auto cleanup every hour
  setInterval(() => cleanupExpiredKeys(client), 60 * 60 * 1000);
});

client.login(TOKEN);

/* ================= EXPORT VALIDATE FUNCTION ================= */
export { validateKey };
