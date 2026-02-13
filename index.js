import http from "http";
import crypto from "crypto";
import fs from "fs";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

/* ================= CONFIG ================= */

const PORT = process.env.PORT || 8080;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1470621891600584744";
const DB_FILE = "./database.json";

/* ================= DATABASE ================= */

let db = {
  availableKeys: [],
  usedKeys: {}
};

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ================= KEY LOGIC ================= */

function generateKey() {
  return "PELICAN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

function tierExpiry(tier) {
  const now = Date.now();
  if (tier === "24h") return now + 24 * 60 * 60 * 1000;
  if (tier === "7d") return now + 7 * 24 * 60 * 60 * 1000;
  if (tier === "30d") return now + 30 * 24 * 60 * 60 * 1000;
  if (tier === "lifetime") return null;
  return null;
}

function generateBulk(amount, tier) {
  const keys = [];
  for (let i = 0; i < amount; i++) {
    const key = generateKey();
    const expiry = tierExpiry(tier);
    db.availableKeys.push({ key, tier, expiry });
    keys.push(key);
  }
  saveDB();
  console.log("Generated keys:\n" + keys.join("\n"));
  return keys;
}

/* ================= HTTP SERVER ================= */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const key = url.searchParams.get("key");
  const hwid = url.searchParams.get("hwid");

  res.setHeader("Content-Type", "text/plain");

  if (path === "/validate") {
    if (!key || !hwid) return res.end("invalid");

    const used = db.usedKeys[key];
    if (!used) return res.end("invalid");

    if (used.expiry && Date.now() > used.expiry) {
      return res.end("expired");
    }

    if (used.hwid && used.hwid !== hwid) {
      return res.end("hwid_mismatch");
    }

    if (!used.hwid) {
      used.hwid = hwid;
      saveDB();
    }

    return res.end("valid");
  }

  if (path === "/keysleft") {
    return res.end(db.availableKeys.length.toString());
  }

  res.end("Pelican License Server Running");
});

server.listen(PORT, () => {
  console.log("HTTP server running on port", PORT);
});

/* ================= DISCORD BOT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log("Discord bot ready");
});

/* ================= COMMANDS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("makekeys")
    .setDescription("Generate license keys")
    .addIntegerOption(o =>
      o.setName("amount").setRequired(true).setDescription("Amount"))
    .addStringOption(o =>
      o.setName("tier").setRequired(true).setDescription("Tier")
        .addChoices(
          { name: "24 Hours", value: "24h" },
          { name: "7 Days", value: "7d" },
          { name: "30 Days", value: "30d" },
          { name: "Lifetime", value: "lifetime" }
        )),

  new SlashCommandBuilder()
    .setName("gen")
    .setDescription("Assign a key to a user")
    .addUserOption(o =>
      o.setName("user").setRequired(true).setDescription("User")),

  new SlashCommandBuilder()
    .setName("keysleft")
    .setDescription("Check remaining keys")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
})();

/* ================= INTERACTIONS ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const isAdmin = member.roles.cache.has(ADMIN_ROLE_ID);

  if (!isAdmin) {
    return interaction.reply({ content: "No permission.", ephemeral: true });
  }

  if (interaction.commandName === "makekeys") {
    const amount = interaction.options.getInteger("amount");
    const tier = interaction.options.getString("tier");

    const keys = generateBulk(amount, tier);

    await interaction.reply({
      content: `Generated ${amount} ${tier} keys.`,
      ephemeral: true
    });

    await interaction.user.send(
      `Generated Keys (${tier}):\n\n` + keys.join("\n")
    );
  }

  if (interaction.commandName === "gen") {
    if (db.availableKeys.length === 0) {
      return interaction.reply({ content: "No keys left.", ephemeral: true });
    }

    const user = interaction.options.getUser("user");
    const keyData = db.availableKeys.shift();

    db.usedKeys[keyData.key] = {
      userId: user.id,
      hwid: null,
      expiry: keyData.expiry
    };

    saveDB();

    await user.send(`Your License Key:\n${keyData.key}`);
    await interaction.reply({ content: "Key sent.", ephemeral: true });
  }

  if (interaction.commandName === "keysleft") {
    await interaction.reply({
      content: `Keys remaining: ${db.availableKeys.length}`,
      ephemeral: true
    });
  }
});

client.login(DISCORD_TOKEN);
