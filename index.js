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

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 8080;

const ADMIN_ROLE_ID = "1470594684383395934";
const FOUNDER_ROLE_ID = "1470595418080546848";
const CUSTOMER_ROLE_ID = "1470600210597282028"; // replace with your role ID

const DATA_FILE = "/app/data/data.json";
const HWID_RESET_COOLDOWN = 24 * 60 * 60 * 1000;

/* ================= STORAGE ================= */
if (!fs.existsSync("/app/data")) fs.mkdirSync("/app/data", { recursive: true });

let db = { keys: {}, users: {}, blacklist: [], rateLimits: {} };

if (fs.existsSync(DATA_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    console.log("[DB] Loaded");
  } catch {
    console.log("[DB] Corrupted, starting fresh");
  }
}

const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const getUserData = (userId) => {
  if (!db.users[userId]) {
    db.users[userId] = {
      hwid: null,
      ip: null,
      execs: 0,
      key: null,
      expiry: null,
      lastHWIDReset: 0,
      violations: 0
    };
  }
  return db.users[userId];
};

/* ================= KEY GEN ================= */
const genKey = (tier = "30d", script = "global") => {
  const key = "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  let expiry = null;
  if (tier === "7d") expiry = Date.now() + 7 * 86400000;
  if (tier === "30d") expiry = Date.now() + 30 * 86400000;

  db.keys[key] = { assignedTo: null, expiry, tier, script, flagged: 0 };
  save();
  return key;
};

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const hasRole = (member, roleId) => member.roles.cache.has(roleId);
const createButton = (label, id, style = ButtonStyle.Primary) =>
  new ButtonBuilder().setLabel(label).setCustomId(id).setStyle(style);

/* ================= CUSTOMER PANEL ================= */
const buildCustomerPanel = (userId) => {
  const user = getUserData(userId);

  return new EmbedBuilder()
    .setTitle("🔷 Pelican Control Panel 🔷")
    .setColor("Green")
    .setDescription(`Welcome to Pelican.win, a free script hub with optional premium keys.
We support many games and most executors.

🔹 Get Script 🔹 Get Stats
View key info, status, expiration, and other details.
Get your personal script with your key already attached.

🔹 Redeem Key
Redeem a purchased key to unlock premium features.

🔹 Reset HWID
Reset your hardware ID if you changed PC or executor.

Premium keys are optional but unlock more power.
👉 Buy keys here:
<#1470650486666301443>`)
    .addFields(
      { name: "Key", value: user.key || "None", inline: false },
      { name: "Tier", value: user.key ? db.keys[user.key]?.tier || "Unknown" : "None", inline: true },
      { name: "Expiry", value: user.expiry ? `<t:${Math.floor(user.expiry / 1000)}:R>` : "None", inline: true },
      { name: "Executions", value: user.execs.toString(), inline: true },
      { name: "HWID Locked", value: user.hwid ? "Yes" : "No", inline: true },
      { name: "Violations", value: user.violations.toString(), inline: true }
    );
};

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);

  /* --------- COMMANDS --------- */
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    const type = interaction.options.getString("type");

    /* Admin Panel */
    if (type === "admin") {
      if (!hasRole(interaction.member, ADMIN_ROLE_ID) &&
          !hasRole(interaction.member, FOUNDER_ROLE_ID))
        return interaction.reply({ content: "No permission", ephemeral: true });

      const embed = new EmbedBuilder().setTitle("Admin Panel").setColor("Red");
      const row = new ActionRowBuilder().addComponents(
        createButton("Generate Key", "genKey"),
        createButton("View Keys", "viewKeys"),
        createButton("Revoke Key", "revokeKey", ButtonStyle.Danger),
        createButton("Reset HWID", "resetHWID", ButtonStyle.Secondary)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    /* Customer Panel */
    const embed = buildCustomerPanel(userId);
    const row = new ActionRowBuilder().addComponents(
      createButton("Redeem Key", "redeemKey"),
      createButton("View License Info", "licenseInfo"),
      createButton("Reset My HWID", "selfResetHWID", ButtonStyle.Secondary),
      createButton("Refresh", "refreshPanel", ButtonStyle.Success)
    );

    if (userData.key) row.addComponents(createButton("Get Script", "getScript"));

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  /* --------- BUTTONS --------- */
  if (interaction.isButton()) {
    /* Customer Buttons */
    if (interaction.customId === "refreshPanel") return interaction.update({ embeds: [buildCustomerPanel(userId)] });
    if (interaction.customId === "licenseInfo") return interaction.reply({ embeds: [buildCustomerPanel(userId)], ephemeral: true });

    if (interaction.customId === "selfResetHWID") {
      const now = Date.now();
      if (now - userData.lastHWIDReset < HWID_RESET_COOLDOWN)
        return interaction.reply({ content: "Cooldown active.", ephemeral: true });

      userData.hwid = null;
      userData.ip = null;
      userData.lastHWIDReset = now;
      save();

      return interaction.reply({ content: "Your HWID has been reset.", ephemeral: true });
    }

    if (interaction.customId === "redeemKey") {
      const modal = new ModalBuilder().setCustomId("redeemModal").setTitle("Redeem Key");
      const input = new TextInputBuilder()
        .setCustomId("keyInput")
        .setLabel("Enter your key")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "getScript") {
      const scriptContent = `-- Pelican Script for ${userData.key} --\nprint("Auto-login placeholder")`;
      return interaction.reply({
        content: `Here is your script, ${interaction.user.username}:`,
        files: [{ attachment: Buffer.from(scriptContent), name: "PelicanScript.lua" }],
        ephemeral: true
      });
    }

    /* Admin Buttons */
    if (interaction.customId === "genKey") {
      const modal = new ModalBuilder().setCustomId("genKeyModal").setTitle("Generate Key");
      const tierInput = new TextInputBuilder()
        .setCustomId("tierInput")
        .setLabel("Enter tier (7d or 30d)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(tierInput));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "viewKeys") {
      const keys = Object.entries(db.keys)
        .map(([k, v]) => `${k} - Assigned: ${v.assignedTo || "None"} - Expiry: ${v.expiry ? `<t:${Math.floor(v.expiry/1000)}:R>` : "None"}`)
        .join("\n") || "No keys generated";
      return interaction.reply({ content: keys, ephemeral: true });
    }

    if (interaction.customId === "revokeKey") {
      const modal = new ModalBuilder().setCustomId("revokeKeyModal").setTitle("Revoke Key");
      const keyInput = new TextInputBuilder()
        .setCustomId("revokeInput")
        .setLabel("Enter key to revoke")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "resetHWID") {
      const modal = new ModalBuilder().setCustomId("resetHWIDModal").setTitle("Reset User HWID");
      const userInput = new TextInputBuilder()
        .setCustomId("userInput")
        .setLabel("Enter User ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(userInput));
      return interaction.showModal(modal);
    }
  }

  /* --------- MODAL SUBMIT --------- */
  if (interaction.isModalSubmit()) {
    // Redeem Key
    if (interaction.customId === "redeemModal") {
      const key = interaction.fields.getTextInputValue("keyInput").trim();
      const kData = db.keys[key];

      if (!kData) return interaction.reply({ content: "Invalid key.", ephemeral: true });
      if (kData.expiry && Date.now() > kData.expiry) return interaction.reply({ content: "Key expired.", ephemeral: true });
      if (kData.assignedTo) return interaction.reply({ content: "Key already redeemed.", ephemeral: true });

      kData.assignedTo = userId;
      userData.key = key;
      userData.expiry = kData.expiry;
      save();

      const guild = client.guilds.cache.get(GUILD_ID);
      const member = guild.members.cache.get(userId);
      if (member) member.roles.add(CUSTOMER_ROLE_ID).catch(console.error);

      return interaction.reply({ content: "Key redeemed successfully! You now have access to Get Script.", ephemeral: true });
    }

    // Admin Generate Key
    if (interaction.customId === "genKeyModal") {
      const tier = interaction.fields.getTextInputValue("tierInput").trim();
      if (!["7d","30d"].includes(tier)) return interaction.reply({ content: "Invalid tier!", ephemeral: true });
      const key = genKey(tier);
      return interaction.reply({ content: `✅ Generated key: \`${key}\``, ephemeral: true });
    }

    // Admin Revoke Key
    if (interaction.customId === "revokeKeyModal") {
      const key = interaction.fields.getTextInputValue("revokeInput").trim();
      const kData = db.keys[key];
      if (!kData) return interaction.reply({ content: "Key not found!", ephemeral: true });

      if (kData.assignedTo) {
        const user = getUserData(kData.assignedTo);
        user.key = null;
        user.expiry = null;
        const guild = client.guilds.cache.get(GUILD_ID);
        const member = guild.members.cache.get(kData.assignedTo);
        if (member) member.roles.remove(CUSTOMER_ROLE_ID).catch(console.error);
      }

      delete db.keys[key];
      save();
      return interaction.reply({ content: `✅ Key ${key} revoked.`, ephemeral: true });
    }

    // Admin Reset HWID
    if (interaction.customId === "resetHWIDModal") {
      const targetId = interaction.fields.getTextInputValue("userInput").trim();
      const user = getUserData(targetId);
      if (!user) return interaction.reply({ content: "User not found!", ephemeral: true });

      user.hwid = null;
      user.ip = null;
      save();
      return interaction.reply({ content: `✅ HWID reset for <@${targetId}>.`, ephemeral: true });
    }
  }
});

/* ================= START ================= */
client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Open panel")
      .addStringOption(o => o.setName("type").setDescription("Panel type").setRequired(true)
        .addChoices({ name: "admin", value: "admin" }, { name: "customer", value: "customer" }))
  ];

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

client.login(TOKEN);
