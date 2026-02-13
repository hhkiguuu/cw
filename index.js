import http from "http";
import crypto from "crypto";
import fs from "fs";
import { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

const PORT = process.env.PORT || 8080;
const KEY_FILE = "./keys.json";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // Set in Railway
const GUILD_ID = process.env.GUILD_ID; // Discord server ID
const ADMIN_IDS = ["1470621891600584744"]; // Admins

// Load or init key database
let db = { keys: {} };
try {
  db = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
} catch {
  for (let i = 0; i < 150; i++) {
    const key = "PELICAN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    db.keys[key] = { assigned: false, expiry: null };
  }
  fs.writeFileSync(KEY_FILE, JSON.stringify(db, null, 2));
  console.log("Generated 150 PELICAN keys.");
}

const saveDB = () => fs.writeFileSync(KEY_FILE, JSON.stringify(db, null, 2));

// Validate key for Roblox
const validateKey = (key) => {
  const kData = db.keys[key];
  if (!kData) return "invalid";
  if (kData.expiry && Date.now() > kData.expiry) return "expired";
  if (kData.assigned) return "used";
  kData.assigned = true;
  saveDB();
  return "valid";
};

// HTTP server for Roblox verification
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");
  res.setHeader("Content-Type", "text/plain");
  if (!key) return res.end("Provide a key with ?key=YOUR_KEY");
  res.end(validateKey(key));
});
server.listen(PORT, () => console.log(`Railway Key Server running on port ${PORT}`));

// --- Discord Bot ---
const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

client.once("ready", async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder().setName("gen").setDescription("Generate a key (Admin only)"),
    new SlashCommandBuilder().setName("addkey").setDescription("Add keys manually (Admin only)")
      .addStringOption(opt => opt.setName("keys").setDescription("Comma or newline separated keys").setRequired(true)),
    new SlashCommandBuilder().setName("keysleft").setDescription("Show keys left (Admin only)"),
    new SlashCommandBuilder().setName("customerpanel").setDescription("Open customer panel")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("Commands registered.");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // Admin commands
  if (interaction.isChatInputCommand()) {
    const { commandName, user } = interaction;

    if (["gen", "addkey", "keysleft"].includes(commandName) && !ADMIN_IDS.includes(user.id)) {
      return interaction.reply({ content: "You don't have permission.", ephemeral: true });
    }

    if (commandName === "gen") {
      const available = Object.keys(db.keys).filter(k => !db.keys[k].assigned);
      if (available.length === 0) return interaction.reply({ content: "No keys left!", ephemeral: true });
      const key = available[0];
      db.keys[key].assigned = true;
      saveDB();
      await interaction.user.send(`Your key: ${key}`);
      return interaction.reply({ content: "Sent a key to your DMs!", ephemeral: true });
    }

    if (commandName === "addkey") {
      const keys = interaction.options.getString("keys").split(/\s|,/).filter(Boolean);
      keys.forEach(k => db.keys[k] = { assigned: false, expiry: null });
      saveDB();
      return interaction.reply({ content: `Added ${keys.length} keys.`, ephemeral: true });
    }

    if (commandName === "keysleft") {
      const available = Object.keys(db.keys).filter(k => !db.keys[k].assigned).length;
      return interaction.reply({ content: `Keys left: ${available}`, ephemeral: true });
    }

    if (commandName === "customerpanel") {
      const member = interaction.guild.members.cache.get(interaction.user.id);
      // Only let users with Customer role use panel
      const hasRole = member.roles.cache.some(r => r.name === "Customer");
      if (!hasRole) return interaction.reply({ content: "You need the Customer role to open the panel.", ephemeral: true });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId("getkey").setLabel("Get Key").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("getscript").setLabel("Get Script").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("stats").setLabel("View Stats").setStyle(ButtonStyle.Success)
        );

      return interaction.reply({ content: "Customer Panel:", components: [row], ephemeral: true });
    }
  }

  // Button clicks
  if (interaction.isButton()) {
    const member = interaction.guild.members.cache.get(interaction.user.id);
    const hasRole = member.roles.cache.some(r => r.name === "Customer");
    if (!hasRole) return interaction.reply({ content: "You need the Customer role!", ephemeral: true });

    if (interaction.customId === "getkey") {
      const available = Object.keys(db.keys).filter(k => !db.keys[k].assigned);
      if (available.length === 0) return interaction.reply({ content: "No keys left!", ephemeral: true });
      const key = available[0];
      db.keys[key].assigned = true;
      saveDB();
      await interaction.user.send(`Your key: ${key}`);
      return interaction.reply({ content: "Sent a key to your DMs!", ephemeral: true });
    }

    if (interaction.customId === "getscript") {
      return interaction.reply({ content: "Here is your script: https://pastebin.com/raw/micAhK9e", ephemeral: true });
    }

    if (interaction.customId === "stats") {
      const assigned = Object.values(db.keys).filter(k => k.assigned).length;
      const total = Object.keys(db.keys).length;
      return interaction.reply({ content: `Keys assigned: ${assigned}/${total}`, ephemeral: true });
    }
  }
});

client.login(DISCORD_TOKEN);
