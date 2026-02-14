import fs from "fs";
import crypto from "crypto";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } from "discord.js";
import http from "http";

const PORT = process.env.PORT || 8080;
const DB_FILE = "./keys.json";
const VERIFY_URL = "https://pelican-win-paid.onrender.com"; // Lua verification URL

const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // bot token
const ADMIN_CHANNEL_ID = "1470650486666301443";
const ADMIN_ROLES = ["1470621891600584744", "1470595418080546848"];
const CUSTOMER_ROLE = "1470600210597282028";

// Load or initialize database
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  if (!db.keys) db.keys = {};
  if (!db.users) db.users = {};
  if (!db.blacklist) db.blacklist = [];
  if (!db.hwid) db.hwid = {};
} catch {
  db = { keys: {}, users: {}, blacklist: [], hwid: {} };
}
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });
client.once("ready", async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  await deployCommands();
});

// Slash commands registration
async function deployCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const commands = [
    new SlashCommandBuilder().setName("customerp").setDescription("Open customer panel"),
    new SlashCommandBuilder().setName("gen").setDescription("Generate a new key").addIntegerOption(opt => opt.setName("expiry").setDescription("Expiry in days")),
    new SlashCommandBuilder().setName("genprekey").setDescription("Give a preloaded key"),
    new SlashCommandBuilder().setName("keysleft").setDescription("Show remaining keys"),
    new SlashCommandBuilder().setName("blacklist").setDescription("Blacklist a key").addStringOption(opt => opt.setName("key").setDescription("Key to blacklist")),
    new SlashCommandBuilder().setName("forcehwid").setDescription("Force reset HWID").addUserOption(opt => opt.setName("user").setDescription("Target user"))
  ];
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

// Generate new key
const generateKey = (expiryDays = 1) => {
  const key = "PELICAN-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const expiry = Date.now() + expiryDays * 24 * 60 * 60 * 1000;
  db.keys[key] = { assigned: false, expiry };
  saveDB();
  return key;
};

// Validate key
const validateKey = (key, userId, hwid) => {
  const data = db.keys[key];
  if (!data || db.blacklist.includes(key)) return "invalid";
  if (data.expiry && Date.now() > data.expiry) return "expired";
  if (data.assigned && db.users[key] !== userId) return "used";
  if (db.hwid[userId] && db.hwid[userId] !== hwid) return "hwid_mismatch";

  db.keys[key].assigned = true;
  db.users[key] = userId;
  db.hwid[userId] = hwid;
  saveDB();
  return "valid";
};

// HTTP key server
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");
  const action = urlObj.searchParams.get("action");
  const userId = urlObj.searchParams.get("user");
  const hwid = urlObj.searchParams.get("hwid");

  res.setHeader("Content-Type", "text/plain");

  if (action === "validate") {
    const result = validateKey(key, userId, hwid);
    return res.end(result);
  }

  if (action === "generate") {
    const expiry = parseInt(urlObj.searchParams.get("expiry")) || 1;
    return res.end(generateKey(expiry));
  }

  res.end("Key system active");
});

server.listen(PORT, () => console.log(`Key server running on port ${PORT}`));

// Slash command handler
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const memberRoles = interaction.member.roles.cache.map(r => r.id);
  const isAdmin = memberRoles.some(r => ADMIN_ROLES.includes(r));

  const cmd = interaction.commandName;

  if (cmd === "customerp") {
    const embed = new EmbedBuilder()
      .setTitle("PELICAN.WIN Customer Panel")
      .setDescription("**Buttons:**\n• Redeem Key → Submit your key via modal\n• Reset HWID → Reset your HWID (24h cooldown)\n• Get Script → Receives your Lua loader link")
      .setColor(0x00FF00);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("redeemKey").setLabel("Redeem Key").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("resetHWID").setLabel("Reset HWID").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("getScript").setLabel("Get Script").setStyle(ButtonStyle.Success)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
  }

  if (!isAdmin) return;

  if (cmd === "gen") {
    const expiry = interaction.options.getInteger("expiry") || 1;
    const newKey = generateKey(expiry);
    await interaction.reply(`Generated new key: \`${newKey}\` (expires in ${expiry} day(s))`);
  }

  if (cmd === "genprekey") {
    const unassigned = Object.keys(db.keys).filter(k => !db.users[k]);
    if (unassigned.length === 0) return interaction.reply("No unassigned preloaded keys left.");
    const key = unassigned[Math.floor(Math.random() * unassigned.length)];
    await interaction.reply(`Preloaded key: \`${key}\``);
  }

  if (cmd === "keysleft") {
    const remaining = Object.values(db.keys).filter(k => !k.assigned).length;
    await interaction.reply(`Remaining unassigned keys: **${remaining}**`);
  }

  if (cmd === "blacklist") {
    const key = interaction.options.getString("key");
    if (!db.keys[key]) return interaction.reply("Key not found!");
    db.blacklist.push(key);
    saveDB();
    await interaction.reply(`Key \`${key}\` has been blacklisted.`);
  }

  if (cmd === "forcehwid") {
    const targetUser = interaction.options.getUser("user");
    if (!targetUser) return interaction.reply("User not found!");
    delete db.hwid[targetUser.id];
    saveDB();
    await interaction.reply(`Forced HWID reset for <@${targetUser.id}>.`);
  }
});
client.login(DISCORD_TOKEN);