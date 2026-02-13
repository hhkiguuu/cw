import http from "http";
import fs from "fs";
import crypto from "crypto";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 8080;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const ADMIN_ROLE = "1470621891600584744";
const FOUNDER_ROLE = "1470595418080546848";
const CUSTOMER_ROLE = "1470600210597282028";
const CUSTOMER_CHANNEL = "<#1470650486666301443>";

const DB_FILE = "./keys.json";

/* ================= DATABASE ================= */
let db = { keys: {} };

try {
  const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (parsed && parsed.keys) db = parsed;
} catch {}

const saveDB = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

/* ================= KEY GENERATION ================= */
const tierExpiry = (tier) => {
  const now = Date.now();
  if (tier === "24h") return now + 86400000;
  if (tier === "7d") return now + 7 * 86400000;
  if (tier === "30d") return now + 30 * 86400000;
  return null; // lifetime
};

const generateInitialKeys = () => {
  if (Object.keys(db.keys).length > 0) return;

  console.log("Generating 150 keys...");
  for (let i = 0; i < 150; i++) {
    const key = "PELICAN-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    db.keys[key] = {
      used: false,
      tier: "lifetime",
      expiry: null,
      hwid: null
    };
  }
  saveDB();
};

generateInitialKeys();

const getUnusedKey = () =>
  Object.entries(db.keys).find(([_, v]) => !v.used);

/* ================= AUTH LOGIC ================= */
const validateKey = (key, hwid) => {
  const data = db.keys[key];
  if (!data) return "invalid";
  if (data.expiry && Date.now() > data.expiry) return "expired";
  if (data.used && data.hwid !== hwid) return "hwid";
  if (!data.used) {
    data.used = true;
    data.hwid = hwid;
    saveDB();
  }
  return "valid";
};

/* ================= HTTP SERVER ================= */
http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = url.searchParams.get("key");
  const hwid = url.searchParams.get("hwid");

  res.setHeader("Content-Type", "text/plain");
  if (!key || !hwid) return res.end("invalid");

  res.end(validateKey(key, hwid));
}).listen(PORT, () =>
  console.log(`Auth server running on ${PORT}`)
);

/* ================= DISCORD BOT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () =>
  console.log(`Bot logged in as ${client.user.tag}`)
);

const isAdmin = (m) =>
  m.roles.cache.has(ADMIN_ROLE) || m.roles.cache.has(FOUNDER_ROLE);

/* ================= COMMANDS ================= */
client.on("messageCreate", async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  const cmd = msg.content.toLowerCase();

  /* -------- GEN -------- */
  if (cmd.startsWith("!gen")) {
    if (!isAdmin(msg.member)) return msg.reply("❌ No permission.");

    const entry = getUnusedKey();
    if (!entry) return msg.reply("❌ No keys left.");

    const [key] = entry;
    await msg.author.send(`🔑 **Your Key:**\n\`${key}\``);
    msg.reply("✅ Key sent to your DMs.");
  }

  /* -------- RESET HWID -------- */
  if (cmd.startsWith("!resethwid")) {
    if (!isAdmin(msg.member)) return msg.reply("❌ No permission.");

    const key = msg.content.split(" ")[1];
    if (!db.keys[key]) return msg.reply("❌ Invalid key.");

    db.keys[key].hwid = null;
    saveDB();
    msg.reply("✅ HWID reset.");
  }

  /* -------- CUSTOMER PANEL -------- */
  if (cmd === "!panel") {
    const embed = new EmbedBuilder()
      .setTitle("🟦 Customer Panel")
      .setDescription(
        [
          "Welcome!",
          "",
          "• Get Script",
          "• Reset HWID",
          "• View Status",
          "",
          `Get keys in ${CUSTOMER_CHANNEL}`
        ].join("\n")
      )
      .setColor(0x3b82f6);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("get_script")
        .setLabel("Get Script")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("reset_hwid")
        .setLabel("Reset HWID")
        .setStyle(ButtonStyle.Secondary)
    );

    msg.reply({ embeds: [embed], components: [row] });
  }
});

/* ================= BUTTON HANDLERS ================= */
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  if (i.customId === "get_script") {
    if (!i.member.roles.cache.has(CUSTOMER_ROLE))
      return i.reply({ content: "❌ Customer only.", ephemeral: true });

    i.reply({
      content: "📜 Script loaded.",
      ephemeral: true
    });
  }

  if (i.customId === "reset_hwid") {
    i.reply({
      content: "🔁 Contact admin to reset HWID.",
      ephemeral: true
    });
  }
});

client.login(DISCORD_TOKEN);
