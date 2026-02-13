import http from "http";
import fs from "fs";
import crypto from "crypto";
import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } from "discord.js";

const PORT = process.env.PORT || 8080;
const DISCORD_TOKEN = "MTQ3MDYxMDEyNTk1Njk3MjYyNQ.GsGnPP.EaWFTpXuyKjFoMDKsbjFWhVBFzSZ_b-KzMDC8Q";
const CUSTOMER_CHANNEL = "<#1470650486666301443>";

// ---------------------------
// Key Database
// ---------------------------
const DB_FILE = "./keys.json";
let db = { keys: {} };

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
} else {
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// Generate keys with optional expiry tier
const generateKeys = (count = 150, prefix = "PELICAN", tier = "24h") => {
  const now = Date.now();
  let expiryMs = null;

  if (tier === "24h") expiryMs = now + 24 * 60 * 60 * 1000;
  if (tier === "7d") expiryMs = now + 7 * 24 * 60 * 60 * 1000;
  if (tier === "30d") expiryMs = now + 30 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const key = `${prefix}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    db.keys[key] = { assigned: false, expiry: expiryMs };
  }
  saveDB();
  console.log(`Generated ${count} keys with tier ${tier}`);
};

// Validate key
const validateKey = (key) => {
  const kData = db.keys[key];
  if (!kData) return "invalid";
  if (kData.expiry && Date.now() > kData.expiry) return "expired";
  if (kData.assigned) return "used";
  kData.assigned = true;
  saveDB();
  return "valid";
};

// ---------------------------
// HTTP Server (Railway API)
// ---------------------------
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");
  res.setHeader("Content-Type", "text/plain");

  if (!key) return res.end("Provide a key with ?key=YOUR_KEY");

  const result = validateKey(key);
  res.end(result);
});

server.listen(PORT, () => console.log(`Railway Key Server running on port ${PORT}`));

// ---------------------------
// Discord Bot
// ---------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages] });

const ADMIN_ROLE = "1470621891600584744";
const CUSTOMER_ROLE = "1470600210597282028";
const FOUNDER_ROLE = "1470595418080546848";

client.once("ready", async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder().setName("gen").setDescription("Get a key"),
    new SlashCommandBuilder().setName("addkeys").setDescription("Add manual keys").addStringOption(opt => opt.setName("keys").setDescription("Paste keys separated by newline").setRequired(true)),
    new SlashCommandBuilder().setName("keysleft").setDescription("Check remaining keys"),
    new SlashCommandBuilder().setName("panel").setDescription("Customer panel"),
    new SlashCommandBuilder().setName("genwithtier").setDescription("Get key with tier").addStringOption(opt => opt.setName("tier").setDescription("24h, 7d, 30d").setRequired(false))
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
});

// Helper
const hasRole = (member, roleId) => member.roles.cache.has(roleId);

// Interaction
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const user = interaction.user;

  if (interaction.commandName === "gen") {
    if (!hasRole(interaction.member, CUSTOMER_ROLE)) return interaction.reply({ content: "You are not a customer!", ephemeral: true });
    const key = Object.keys(db.keys).find(k => !db.keys[k].assigned);
    if (!key) return interaction.reply({ content: "No keys available!", ephemeral: true });
    db.keys[key].assigned = true;
    saveDB();
    await user.send(`Here is your key: ${key}`);
    interaction.reply({ content: "Check your DMs for the key!", ephemeral: true });
  }

  if (interaction.commandName === "genwithtier") {
    if (!hasRole(interaction.member, CUSTOMER_ROLE)) return interaction.reply({ content: "You are not a customer!", ephemeral: true });
    const tier = interaction.options.getString("tier") || "24h";
    const key = Object.keys(db.keys).find(k => !db.keys[k].assigned && db.keys[k].expiry !== null && ((tier==="24h" && db.keys[k].expiry - Date.now() <= 24*60*60*1000) || (tier==="7d" && db.keys[k].expiry - Date.now() <= 7*24*60*60*1000) || (tier==="30d" && db.keys[k].expiry - Date.now() <= 30*24*60*60*1000)));
    if (!key) return interaction.reply({ content: `No ${tier} keys available!`, ephemeral: true });
    db.keys[key].assigned = true;
    saveDB();
    await user.send(`Here is your ${tier} key: ${key}`);
    interaction.reply({ content: "Check your DMs for the key!", ephemeral: true });
  }

  if (interaction.commandName === "addkeys") {
    if (!hasRole(interaction.member, ADMIN_ROLE) && !hasRole(interaction.member, FOUNDER_ROLE))
      return interaction.reply({ content: "You do not have permission!", ephemeral: true });

    const keysToAdd = interaction.options.getString("keys").split("\n");
    keysToAdd.forEach(k => db.keys[k.trim()] = { assigned: false, expiry: null });
    saveDB();
    interaction.reply({ content: `Added ${keysToAdd.length} keys!`, ephemeral: true });
  }

  if (interaction.commandName === "keysleft") {
    const remaining = Object.values(db.keys).filter(k => !k.assigned).length;
    interaction.reply({ content: `Keys remaining: ${remaining}`, ephemeral: true });
  }

  if (interaction.commandName === "panel") {
    const embed = new EmbedBuilder()
      .setTitle("Customer Panel")
      .setDescription("Get keys or check your status here!")
      .addFields({ name: "Channel", value: CUSTOMER_CHANNEL })
      .setColor("#34D399");
    interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// Login
client.login(DISCORD_TOKEN);

// ---------------------------
// Generate initial keys if empty
// ---------------------------
if (Object.keys(db.keys).length === 0) {
  generateKeys(50, "PELICAN", "24h");
  generateKeys(30, "PELICAN", "7d");
  generateKeys(20, "PELICAN", "30d");
}
