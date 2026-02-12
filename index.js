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

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 8080;

const ADMIN_ROLE_ID = "1470594684383395934";
const CUSTOMER_ROLE_ID = "1470600210597282028";
const FOUNDER_ROLE_ID = "1470595418080546848";
const DATA_FILE = "./data.json";

/* ================= DATA STORAGE ================= */
let db = { keys: {}, users: {}, blacklist: [], suggestions: [] };
if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DATA_FILE));
    } catch (e) {
        console.error("Data file corrupt, using defaults.");
    }
}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

function getUserData(userId) {
  if (!db.users[userId])
    db.users[userId] = { hwid: null, execs: 0, key: null, expiry: null, lastHWIDReset: 0 };
  return db.users[userId];
}

/* ================= DISCORD CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

/* ================= SLASH COMMANDS DEPLOY ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Show admin or customer panel")
    .addStringOption(o =>
      o.setName("type")
        .setDescription("admin or customer")
        .setRequired(true)
        .addChoices({ name: "admin", value: "admin" }, { name: "customer", value: "customer" })
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

/* ================= INTERACTION HANDLER ================= */
client.on("interactionCreate", async (interaction) => {
    // Paste all your existing interaction logic here (Buttons, Modals, etc.)
    // Make sure to use the 'db', 'save', and 'getUserData' functions defined above.
    
    if (interaction.isChatInputCommand()) {
        const type = interaction.options.getString("type");
        const embed = new EmbedBuilder().setTitle(`CWUV ${type} Panel`).setColor(type === "admin" ? "Red" : "Green");
        // ... (Add your existing panel logic here)
        await interaction.reply({ embeds: [embed], content: "Panel deployed." });
    }
    
    // REDEEM KEY MODAL LOGIC...
});

/* ================= WEB API (THE KEY SYSTEM) ================= */
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/validate" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { key, userId, hwid } = JSON.parse(body);
        const keyData = db.keys[key];
        const userData = getUserData(userId);

        if (!keyData || keyData.assignedTo !== userId) {
            return res.end(JSON.stringify({ valid: false, message: "Invalid Key Access" }));
        }

        if (userData.hwid && userData.hwid !== hwid) {
            return res.end(JSON.stringify({ valid: false, message: "HWID Mismatch!" }));
        }

        if (!userData.hwid) { userData.hwid = hwid; save(); }
        
        userData.execs++;
        save();
        
        res.end(JSON.stringify({ valid: true, message: "Welcome!" }));
      } catch (e) {
        res.end(JSON.stringify({ valid: false, message: "API Error" }));
      }
    });
  } else {
    res.end("Pinger running - Bot & API are Online");
  }
});

/* ================= STARTUP ================= */
client.once("ready", async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log("Commands synced.");
  } catch (err) {
    console.error("Command sync failed:", err);
  }
});

server.listen(PORT, () => console.log(`API Listening on port ${PORT}`));
client.login(TOKEN);
