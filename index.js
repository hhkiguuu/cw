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

const revokeKey = (key) => {
  if (db.keys[key]) {
    const assignedTo = db.keys[key].assignedTo;
    if (assignedTo) {
      const user = getUserData(assignedTo);
      user.key = null;
      user.expiry = null;
    }
    delete db.keys[key];
    save();
    return true;
  }
  return false;
};

const extendKey = (key, days) => {
  if (db.keys[key] && db.keys[key].expiry) {
    db.keys[key].expiry += days * 86400000;
    save();
    return true;
  }
  return false;
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
    .setTitle("**Pelican Control Panel**\n🔷 Pelican Control Panel 🔷")
    .setColor("Blue")
    .setDescription(`Welcome to Pelican.win, a free script hub with optional premium keys.
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

  if (!interaction.member || !interaction.member.roles) {
    const guild = await client.guilds.fetch(GUILD_ID);
    interaction.member = await guild.members.fetch(userId);
  }

  const userData = getUserData(userId);
  const isCustomer = interaction.member.roles.cache.has(CUSTOMER_ROLE_ID);
  const isAdmin =
    interaction.member.roles.cache.has(ADMIN_ROLE_ID) ||
    interaction.member.roles.cache.has(FOUNDER_ROLE_ID);

  const activeKey =
    userData.key &&
    db.keys[userData.key] &&
    (!db.keys[userData.key].expiry || Date.now() < db.keys[userData.key].expiry);

  /* ================= SLASH COMMAND ================= */
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.getString("type");

    if (type === "customer") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("getScript").setLabel("Get Script").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("redeemKey").setLabel("Redeem Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("selfResetHWID").setLabel("Reset HWID").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("getStats").setLabel("Get Stats").setStyle(ButtonStyle.Primary)
      );

      return interaction.editReply({
        embeds: [buildCustomerPanel()],
        components: [row],
      });
    }

    if (type === "admin") {
      if (!isAdmin) return interaction.editReply({ content: "❌ You are not an admin." });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("genKeyAdmin").setLabel("Generate Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("revokeKeyAdmin").setLabel("Revoke Key").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("extendKeyAdmin").setLabel("Extend Key").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("viewKeysAdmin").setLabel("View Keys").setStyle(ButtonStyle.Secondary)
      );

      return interaction.editReply({
        content: "Admin Panel",
        components: [row],
      });
    }
  }

  /* ================= BUTTON INTERACTIONS ================= */
  if (interaction.isButton()) {
    if (!isCustomer && !interaction.customId.includes("Admin") && interaction.customId !== "redeemKey") {
      return interaction.reply({
        content: "❌ You do not have an active key.",
        ephemeral: true,
      });
    }

    switch (interaction.customId) {
      /* ================= CUSTOMER BUTTONS ================= */
      case "getScript":
        return interaction.reply({ content: `Here’s your script with your key: ${userData.key || "None"}`, ephemeral: true });

      case "selfResetHWID":
        const now = Date.now();
        if (now - userData.lastHWIDReset < HWID_RESET_COOLDOWN)
          return interaction.reply({ content: "Cooldown active. Please wait before resetting HWID again.", ephemeral: true });

        userData.hwid = null;
        userData.ip = null;
        userData.lastHWIDReset = now;
        save();

        return interaction.reply({ content: "✅ Your HWID has been reset.", ephemeral: true });

      case "getStats":
        return interaction.reply({
          content: `Key: ${userData.key || "None"}\nTier: ${userData.key ? db.keys[userData.key].tier : "N/A"}\nExpiry: ${userData.expiry ? `<t:${Math.floor(userData.expiry/1000)}:R>` : "N/A"}\nExecutions: ${userData.execs}\nViolations: ${userData.violations}`,
          ephemeral: true,
        });

      case "redeemKey":
        const modal = new ModalBuilder().setCustomId("redeemModal").setTitle("Redeem Key");
        const input = new TextInputBuilder().setCustomId("keyInput").setLabel("Enter your key").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);

      /* ================= ADMIN BUTTONS ================= */
      case "genKeyAdmin":
        const genModal = new ModalBuilder().setCustomId("genKeyModal").setTitle("Generate Key");
        const tierInput = new TextInputBuilder().setCustomId("tierInput").setLabel("Tier (7d,30d,lifetime)").setStyle(TextInputStyle.Short).setRequired(true);
        genModal.addComponents(new ActionRowBuilder().addComponents(tierInput));
        return interaction.showModal(genModal);

      case "revokeKeyAdmin":
        const revokeModal = new ModalBuilder().setCustomId("revokeKeyModal").setTitle("Revoke Key");
        const revokeInput = new TextInputBuilder().setCustomId("revokeKeyInput").setLabel("Enter key to revoke").setStyle(TextInputStyle.Short).setRequired(true);
        revokeModal.addComponents(new ActionRowBuilder().addComponents(revokeInput));
        return interaction.showModal(revokeModal);

      case "extendKeyAdmin":
        const extendModal = new ModalBuilder().setCustomId("extendKeyModal").setTitle("Extend Key");
        const extendKeyInput = new TextInputBuilder().setCustomId("extendKeyInput").setLabel("Enter key").setStyle(TextInputStyle.Short).setRequired(true);
        const extendDaysInput = new TextInputBuilder().setCustomId("extendDaysInput").setLabel("Days to extend").setStyle(TextInputStyle.Short).setRequired(true);
        extendModal.addComponents(new ActionRowBuilder().addComponents(extendKeyInput));
        extendModal.addComponents(new ActionRowBuilder().addComponents(extendDaysInput));
        return interaction.showModal(extendModal);

      case "viewKeysAdmin":
        const keyList = Object.entries(db.keys).map(([k,v]) => `${k} - ${v.assignedTo || "Unassigned"} - ${v.expiry ? `<t:${Math.floor(v.expiry/1000)}:R>` : "Lifetime"}`).join("\n") || "No keys yet";
        return interaction.reply({ content: `📜 Keys:\n${keyList}`, ephemeral: true });
    }
  }

  /* ================= MODAL SUBMIT ================= */
  if (interaction.isModalSubmit()) {
    switch(interaction.customId){
      case "redeemModal":
        const key = interaction.fields.getTextInputValue("keyInput").trim();
        const kData = db.keys[key];

        if(!kData) return interaction.reply({ content:"❌ Invalid key.", ephemeral:true });
        if(kData.expiry && Date.now() > kData.expiry) return interaction.reply({ content:"❌ Key expired.", ephemeral:true });
        if(kData.assignedTo) return interaction.reply({ content:"❌ Key already redeemed.", ephemeral:true });

        kData.assignedTo = userId;
        userData.key = key;
        userData.expiry = kData.expiry;

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userId);
        await member.roles.add(CUSTOMER_ROLE_ID);

        save();
        return interaction.reply({ content:"✅ Key redeemed successfully!", ephemeral:true });

      case "genKeyModal":
        const tier = interaction.fields.getTextInputValue("tierInput").trim();
        const newKey = genKey(tier);
        return interaction.reply({ content:`✅ Generated key: ${newKey}`, ephemeral:true });

      case "revokeKeyModal":
        const rKey = interaction.fields.getTextInputValue("revokeKeyInput").trim();
        if(revokeKey(rKey)) return interaction.reply({ content:`✅ Key revoked: ${rKey}`, ephemeral:true });
        return interaction.reply({ content:`❌ Key not found: ${rKey}`, ephemeral:true });

      case "extendKeyModal":
        const eKey = interaction.fields.getTextInputValue("extendKeyInput").trim();
        const days = parseInt(interaction.fields.getTextInputValue("extendDaysInput").trim());
        if(!days || days <=0) return interaction.reply({ content:"❌ Invalid number of days.", ephemeral:true });
        if(extendKey(eKey, days)) return interaction.reply({ content:`✅ Extended key ${eKey} by ${days} days.`, ephemeral:true });
        return interaction.reply({ content:`❌ Key not found: ${eKey}`, ephemeral:true });
    }
  }
});

/* ================= HTTP SERVER FOR LUA ================= */
http.createServer((req,res)=>{
  const parsed = url.parse(req.url,true);
  const q = parsed.query;

  res.setHeader("Content-Type","text/plain");

  if(q.verify && q.key && q.hwid && q.ip){
    const result = validateKey(q.key,q.hwid,q.ip);
    return res.end(result.valid?"valid":result.reason);
  }

  res.end("Key server running");
}).listen(PORT,()=>console.log(`Key server running on port ${PORT}`));

/* ================= START BOT ================= */
client.once("ready",async()=>{
  console.log("Bot Ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Open panel")
      .addStringOption(o=>o.setName("type").setDescription("Panel type").setRequired(true).addChoices({name:"admin",value:"admin"},{name:"customer",value:"customer"}))
  ];

  await rest.put(Routes.applicationGuildCommands(client.user.id,GUILD_ID),{ body:commands });

  setInterval(()=>cleanupExpiredKeys(client),60*60*1000);
});

client.login(TOKEN);

/* ================= EXPORT VALIDATE FUNCTION ================= */
export { validateKey };
