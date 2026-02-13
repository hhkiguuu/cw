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

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1470594684383395934";
const FOUNDER_ROLE_ID = "1470595418080546848";
const CUSTOMER_ROLE_ID = "1470600210597282028";

const DATA_FILE = "./data.json";
const PORT = process.env.PORT || 8080;

// ================= STORAGE =================
let db = { keys: {}, users: {}, blacklist: [] };
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const getUserData = (userId) => {
  if (!db.users[userId]) db.users[userId] = { key: null, expiry: null, hwid: null, ip: null, execs: 0, violations: 0, lastHWIDReset: 0 };
  return db.users[userId];
};

// ================= RAILWAY KEY SERVER =================
let serverKeys = {};
const generateRailwayKeys = (count = 150) => {
  for (let i = 0; i < count; i++) {
    const key = "PELICAN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    serverKeys[key] = { assigned: false, expiry: null };
  }
  console.log("Railway Keys Generated:");
  console.log(Object.keys(serverKeys).join("\n"));
};
generateRailwayKeys();

const validateRailwayKey = (key, hwid, ip) => {
  const kData = db.keys[key];
  if (!kData) return { valid: false, reason: "invalid" };
  if (kData.expiry && Date.now() > kData.expiry) return { valid: false, reason: "expired" };
  if (kData.assignedTo && kData.hwid !== hwid) return { valid: false, reason: "HWID mismatch" };
  if (kData.assignedTo && kData.ip !== ip) return { valid: false, reason: "IP mismatch" };

  const user = getUserData(kData.assignedTo);
  if (!user.hwid) user.hwid = hwid;
  if (!user.ip) user.ip = ip;
  user.execs++;
  save();
  return { valid: true };
};

http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");
  const hwid = urlObj.searchParams.get("hwid") || "none";
  const ip = urlObj.searchParams.get("ip") || "none";

  res.setHeader("Content-Type", "text/plain");

  if (!key) return res.end("Provide ?key=YOUR_KEY");

  const result = validateRailwayKey(key, hwid, ip);
  res.end(result.valid ? "valid" : result.reason);
}).listen(PORT, () => console.log(`Railway Key Server running on port ${PORT}`));

// ================= DISCORD BOT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], partials: [Partials.Channel] });
const hasRole = (member, roleId) => member.roles.cache.has(roleId);

const buildCustomerPanel = () => new EmbedBuilder()
  .setTitle("🔷 Pelican Control Panel 🔷")
  .setColor("Blue")
  .setDescription(`Welcome to Pelican.win, a free script hub with optional premium keys.
Buttons:

🔹 Get Script – Only with active key
🔹 Redeem Key – Unlock premium features
🔹 Reset HWID – Only with active key
🔹 Get Stats – Only visible after pressing button

Buy premium keys: <#1470650486666301443>`);

// ================= BOT COMMANDS =================
client.on("interactionCreate", async (interaction) => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);
  const activeKey = userData.key && db.keys[userData.key];

  const isAdmin = interaction.member && (hasRole(interaction.member, ADMIN_ROLE_ID) || hasRole(interaction.member, FOUNDER_ROLE_ID));

  if (interaction.isChatInputCommand()) {
    const type = interaction.options.getString("type");

    if (type === "customer") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("getScript").setLabel("Get Script").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("redeemKey").setLabel("Redeem Key").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("resetHWID").setLabel("Reset HWID").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("getStats").setLabel("Get Stats").setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({ embeds: [buildCustomerPanel()], components: [row], ephemeral: false });
    }

    if (type === "admin" && isAdmin) {
      // Admin commands as slash commands
      return interaction.reply({ content: "Admin Panel (commands work via /gen, /revoke, /viewkeys, /key add)", ephemeral: false });
    }
  }

  // Customer button logic
  if (interaction.isButton()) {
    if (!activeKey && !["redeemKey"].includes(interaction.customId))
      return interaction.reply({ content: "❌ You need an active key.", ephemeral: true });

    if (interaction.customId === "redeemKey") {
      const modal = new ModalBuilder().setCustomId("redeemModal").setTitle("Redeem Key");
      const input = new TextInputBuilder().setCustomId("keyInput").setLabel("Enter your key").setStyle(TextInputStyle.Short);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "getStats") {
      return interaction.reply({ content: `Key: ${userData.key || "None"}\nExpiry: ${activeKey?.expiry || "N/A"}`, ephemeral: true });
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === "redeemModal") {
    const key = interaction.fields.getTextInputValue("keyInput").trim();
    const kData = db.keys[key];
    if (!kData) return interaction.reply({ content: "Invalid key.", ephemeral: true });

    kData.assignedTo = userId;
    kData.hwid = null;
    kData.ip = null;
    userData.key = key;
    userData.expiry = kData.expiry;
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);
    await member.roles.add(CUSTOMER_ROLE_ID);
    save();
    return interaction.reply({ content: "Key redeemed!", ephemeral: true });
  }
});

// ================= ADMIN COMMANDS =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const isAdmin = interaction.member && (hasRole(interaction.member, ADMIN_ROLE_ID) || hasRole(interaction.member, FOUNDER_ROLE_ID));
  if (!isAdmin) return;

  const cmd = interaction.commandName;

  if (cmd === "gen") {
    // Find first unused key in db.keys
    const unassigned = Object.keys(db.keys).filter(k => !db.keys[k].assignedTo);
    if (unassigned.length === 0) return interaction.reply({ content: "No keys available!", ephemeral: true });

    const key = unassigned[0];
    db.keys[key].assignedTo = interaction.user.id;
    save();
    // DM user
    interaction.user.send(`Generated Key: ${key}`);
    return interaction.reply({ content: "✅ Key sent to your DMs.", ephemeral: true });
  }

  if (cmd === "keyadd") {
    const raw = interaction.options.getString("keys");
    const keys = raw.split("\n").map(k => k.trim()).filter(k => k);
    for (const k of keys) db.keys[k] = { assignedTo: null, expiry: null };
    save();
    return interaction.reply({ content: `Added ${keys.length} keys!`, ephemeral: true });
  }
});

// ================= START =================
client.once("ready", async () => {
  console.log("Bot Ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const commands = [
    new SlashCommandBuilder().setName("setup").setDescription("Open panel")
      .addStringOption(o => o.setName("type").setDescription("Panel type").setRequired(true).addChoices({ name: "customer", value: "customer" }, { name: "admin", value: "admin" })),
    new SlashCommandBuilder().setName("gen").setDescription("Generate a key for user"),
    new SlashCommandBuilder().setName("keyadd").setDescription("Add multiple keys").addStringOption(o => o.setName("keys").setDescription("Paste keys here, one per line").setRequired(true))
  ];

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

client.login(TOKEN);
