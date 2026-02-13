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
  if (!db.users[userId]) db.users[userId] = { key: null, expiry: null, hwid: null, ip: null, execs: 0, violations: 0, lastHWIDReset: 0 };
  return db.users[userId];
};

/* ================= KEY FUNCTIONS ================= */
// Add keys manually (paste in keys in bulk)
const addKeys = (keys) => {
  keys.forEach(k => {
    if (!db.keys[k]) db.keys[k] = { assignedTo: null, expiry: null, used: false, hwid: null, ip: null, violations: 0 };
  });
  save();
  console.log(`Added ${keys.length} keys!`);
};

// Auto-generate 150 unique keys with PELICAN prefix
const generateKeys = (count = 150) => {
  for (let i = 0; i < count; i++) {
    const key = "PELICAN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    if (!db.keys[key]) db.keys[key] = { assignedTo: null, expiry: Date.now() + 30 * 24 * 60 * 60 * 1000, hwid: null, ip: null, used: false, violations: 0 };
    console.log("Generated Key:", key); // copy-paste these if needed
  }
  save();
};

// Pick next unassigned key
const getNextKey = () => {
  const next = Object.entries(db.keys).find(([k, v]) => !v.assignedTo);
  return next ? next[0] : null;
};

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
http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const q = parsed.query;
  res.setHeader("Content-Type", "text/plain");

  // Lua verification
  if (q.verify && q.key && q.hwid && q.ip) {
    const result = validateKey(q.key, q.hwid, q.ip);
    return res.end(result.valid ? "valid" : result.reason);
  }

  res.end("Key server running");
}).listen(PORT, () => console.log(`Key server running on port ${PORT}`));

/* ================= DISCORD CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], partials: [Partials.Channel] });
const hasRole = (member, roleId) => member.roles.cache.has(roleId);

/* ================= CUSTOMER PANEL ================= */
const buildCustomerPanel = () => new EmbedBuilder()
  .setTitle("Pelican Control Panel")
  .setColor("Blue")
  .setDescription(`Welcome to Pelican.win .
Buttons explained:

🔹 Get Script – Get your script with your key.
🔹 Redeem Key – Redeem your purchased key.
🔹 Reset HWID – Reset your hardware ID.
🔹 Get Stats – See key info.

Premium keys unlock more power.
👉 Buy keys here: <#1470650486666301443>`);

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);
  const activeKey = userData.key && db.keys[userData.key] && (!db.keys[userData.key].expiry || Date.now() < db.keys[userData.key].expiry);
  const isAdmin = interaction.member && (hasRole(interaction.member, ADMIN_ROLE_ID) || hasRole(interaction.member, FOUNDER_ROLE_ID));

  /* CUSTOMER PANEL */
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

    /* ADMIN COMMANDS */
    if (type === "admin") {
      if (!isAdmin) return interaction.reply({ content: "❌ Not allowed.", ephemeral: true });
      return interaction.reply({ content: "Admin commands active. Use /gen, /key add, /viewkeys, /revoke", ephemeral: true });
    }
  }

  /* BUTTONS */
  if (interaction.isButton()) {
    if (!activeKey && ["getScript", "getStats", "selfResetHWID"].includes(interaction.customId)) {
      return interaction.reply({ content: "❌ You need an active key and customer role.", ephemeral: true });
    }
  }

  /* MODAL */
  if (interaction.isModalSubmit() && interaction.customId === "redeemModal") {
    const key = interaction.fields.getTextInputValue("keyInput").trim();
    const kData = db.keys[key];
    if (!kData) return interaction.reply({ content: "Invalid key.", ephemeral: true });
    if (kData.expiry && Date.now() > kData.expiry) return interaction.reply({ content: "Key expired.", ephemeral: true });
    if (kData.assignedTo) return interaction.reply({ content: "Key already redeemed.", ephemeral: true });

    kData.assignedTo = userId;
    userData.key = key;
    userData.expiry = kData.expiry;

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);
    await member.roles.add(CUSTOMER_ROLE_ID);

    save();
    return interaction.reply({ content: "Key redeemed successfully!", ephemeral: true });
  }

  /* ADMIN /gen */
  if (interaction.isChatInputCommand() && interaction.commandName === "gen") {
    if (!isAdmin) return interaction.reply({ content: "❌ Not allowed.", ephemeral: true });
    const targetUser = interaction.options.getUser("user");
    const key = getNextKey();
    if (!key) return interaction.reply({ content: "❌ No keys available.", ephemeral: true });

    db.keys[key].assignedTo = targetUser.id;
    save();

    try {
      await targetUser.send(`✅ Your key: \`${key}\``);
      return interaction.reply({ content: `Key sent to ${targetUser.tag} in DMs.`, ephemeral: true });
    } catch {
      return interaction.reply({ content: "❌ Failed to DM user.", ephemeral: true });
    }
  }

  /* ADMIN /key add */
  if (interaction.isChatInputCommand() && interaction.commandName === "keyadd") {
    if (!isAdmin) return interaction.reply({ content: "❌ Not allowed.", ephemeral: true });
    const keysRaw = interaction.options.getString("keys"); // newline or space separated
    const keys = keysRaw.split(/\s+/).filter(k => k.startsWith("PELICAN-"));
    addKeys(keys);
    return interaction.reply({ content: `✅ Added ${keys.length} keys.`, ephemeral: true });
  }
});

/* ================= BOT START ================= */
client.once("ready", async () => {
  console.log("Bot Ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Open panel")
      .addStringOption(o => o.setName("type").setDescription("Panel type").setRequired(true)
        .addChoices({ name: "admin", value: "admin" }, { name: "customer", value: "customer" })
      ),
    new SlashCommandBuilder()
      .setName("gen")
      .setDescription("Generate key for user")
      .addUserOption(o => o.setName("user").setDescription("Target user")),
    new SlashCommandBuilder()
      .setName("keyadd")
      .setDescription("Add multiple keys")
      .addStringOption(o => o.setName("keys").setDescription("Keys (PELICAN-)").setRequired(true))
  ];

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

client.login(TOKEN);
