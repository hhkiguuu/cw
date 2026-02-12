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
const DATA_FILE = "/app/data/data.json"; // Optimized for Railway Volumes

/* ================= DATA STORAGE ================= */
// Ensure directory exists for Railway Volumes
if (!fs.existsSync("/app/data")) fs.mkdirSync("/app/data", { recursive: true });

let db = { keys: {}, users: {}, blacklist: [], suggestions: [] };

if (fs.existsSync(DATA_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE));
    console.log("Database loaded successfully.");
  } catch (e) {
    console.error("Database corrupted, creating new one.");
  }
}

const save = () => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
  }
};

const genKey = (expiryDays = 30) => {
  const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
  const key = "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  db.keys[key] = { assignedTo: null, expiry: Date.now() + expiryMs };
  save(); // Save immediately after generating
  return key;
};

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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.GuildMember]
});

/* ================= HELPERS ================= */
function createButton(label, customId, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setLabel(label).setCustomId(customId).setStyle(style);
}

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);

  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    const type = interaction.options.getString("type");
    if (type === "admin") {
      const embed = new EmbedBuilder().setTitle("Admin Panel").setColor("Red");
      const row1 = new ActionRowBuilder().addComponents(createButton("Gen Key", "genKey"), createButton("View Keys", "viewKeys"));
      await interaction.reply({ embeds: [embed], components: [row1] });
    } else {
      const embed = new EmbedBuilder().setTitle("Customer Panel").setColor("Green");
      const row = new ActionRowBuilder().addComponents(createButton("Redeem Key", "redeemKey"), createButton("Stats", "viewStats"));
      await interaction.reply({ embeds: [embed], components: [row] });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === "genKey") {
      const key = genKey();
      await interaction.reply({ content: `Key Generated: \`${key}\``, ephemeral: true });
    }

    if (interaction.customId === "viewKeys") {
        const keys = Object.keys(db.keys).slice(-10).join("\n") || "No keys";
        await interaction.reply({ content: `Recent Keys:\n${keys}`, ephemeral: true });
    }

    if (interaction.customId === "redeemKey") {
      const modal = new ModalBuilder().setCustomId("redeemModal").setTitle("Redeem");
      const input = new TextInputBuilder().setCustomId("keyInput").setLabel("Key").setStyle(TextInputStyle.Short);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
    }
    
    if (interaction.customId === "viewStats") {
        await interaction.reply({ content: `Execs: ${userData.execs} | HWID: ${userData.hwid || "None"}`, ephemeral: true });
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === "redeemModal") {
    const key = interaction.fields.getTextInputValue("keyInput").trim();
    if (!db.keys[key]) return interaction.reply({ content: "Invalid Key", ephemeral: true });
    if (db.keys[key].assignedTo) return interaction.reply({ content: "Already Redeemed", ephemeral: true });

    db.keys[key].assignedTo = userId;
    userData.key = key;
    userData.expiry = db.keys[key].expiry;
    save();
    await interaction.reply({ content: "Successfully Redeemed!", ephemeral: true });
  }
});

/* ================= WEB API ================= */
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/validate" && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { key, userId, hwid } = JSON.parse(body);
        const kData = db.keys[key];
        const uData = getUserData(userId);

        if (!kData || kData.assignedTo !== userId) return res.end(JSON.stringify({ valid: false, message: "Invalid key ownership." }));
        if (uData.hwid && uData.hwid !== hwid) return res.end(JSON.stringify({ valid: false, message: "HWID Mismatch." }));
        
        if (!uData.hwid) uData.hwid = hwid;
        uData.execs++;
        save();
        res.end(JSON.stringify({ valid: true, message: "Welcome back!" }));
      } catch (e) { res.end(JSON.stringify({ valid: false })); }
    });
  } else {
    res.end("API Online");
  }
}).listen(PORT);

client.once("ready", async () => {
    console.log("Bot Online");
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const cmd = [new SlashCommandBuilder().setName("setup").setDescription("Panel").addStringOption(o => o.setName("type").setRequired(true).addChoices({name:"admin",value:"admin"},{name:"customer",value:"customer"}))];
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: cmd });
});

client.login(TOKEN);
