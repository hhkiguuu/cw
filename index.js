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

const DATA_FILE = "/app/data/data.json";

/* ================= STORAGE ================= */
if (!fs.existsSync("/app/data")) {
  fs.mkdirSync("/app/data", { recursive: true });
}

let db = {
  keys: {},
  users: {},
  blacklist: [],
  suggestions: []
};

if (fs.existsSync(DATA_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    console.log("[DB] Loaded");
  } catch {
    console.log("[DB] Corrupted, starting fresh");
  }
}

const save = () => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
};

const getUserData = (userId) => {
  if (!db.users[userId]) {
    db.users[userId] = {
      hwid: null,
      execs: 0,
      key: null,
      expiry: null,
      lastHWIDReset: 0
    };
  }
  return db.users[userId];
};

const genKey = (expiryDays = 30) => {
  const expiryMs = expiryDays * 86400000;
  const key = "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();

  db.keys[key] = {
    assignedTo: null,
    expiry: Date.now() + expiryMs
  };

  save();
  return key;
};

/* ================= DISCORD CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.GuildMember]
});

/* ================= HELPERS ================= */
const hasRole = (member, roleId) =>
  member.roles.cache.has(roleId);

const createButton = (label, id, style = ButtonStyle.Primary) =>
  new ButtonBuilder().setLabel(label).setCustomId(id).setStyle(style);

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  const userId = interaction.user.id;
  const userData = getUserData(userId);

  /* ===== SLASH COMMAND ===== */
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    const type = interaction.options.getString("type");
    const member = interaction.member;

    if (type === "admin") {
      if (!hasRole(member, ADMIN_ROLE_ID) && !hasRole(member, FOUNDER_ROLE_ID))
        return interaction.reply({ content: "No permission", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("Admin Panel")
        .setColor("Red");

      const row = new ActionRowBuilder().addComponents(
        createButton("Generate Key", "genKey"),
        createButton("View Keys", "viewKeys")
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    const embed = new EmbedBuilder()
      .setTitle("Customer Panel")
      .setColor("Green");

    const row = new ActionRowBuilder().addComponents(
      createButton("Redeem Key", "redeemKey"),
      createButton("Stats", "viewStats")
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  /* ===== BUTTONS ===== */
  if (interaction.isButton()) {
    if (interaction.customId === "genKey") {
      const key = genKey();
      return interaction.reply({ content: `Key Generated:\n\`${key}\``, ephemeral: true });
    }

    if (interaction.customId === "viewKeys") {
      const list = Object.keys(db.keys).slice(-15).join("\n") || "No keys";
      return interaction.reply({ content: `Recent Keys:\n${list}`, ephemeral: true });
    }

    if (interaction.customId === "redeemKey") {
      const modal = new ModalBuilder()
        .setCustomId("redeemModal")
        .setTitle("Redeem Key");

      const input = new TextInputBuilder()
        .setCustomId("keyInput")
        .setLabel("Enter your key")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "viewStats") {
      return interaction.reply({
        content: `Execs: ${userData.execs}\nHWID: ${userData.hwid || "None"}`,
        ephemeral: true
      });
    }
  }

  /* ===== MODAL ===== */
  if (interaction.isModalSubmit() && interaction.customId === "redeemModal") {
    const key = interaction.fields.getTextInputValue("keyInput").trim();
    const kData = db.keys[key];

    if (!kData)
      return interaction.reply({ content: "Invalid key", ephemeral: true });

    if (kData.assignedTo)
      return interaction.reply({ content: "Key already redeemed", ephemeral: true });

    kData.assignedTo = userId;
    userData.key = key;
    userData.expiry = kData.expiry;

    save();
    return interaction.reply({ content: "Key redeemed successfully", ephemeral: true });
  }
});

/* ================= WEB API ================= */
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "POST" && req.url === "/validate") {
    let body = "";

    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { key, userId, hwid } = JSON.parse(body);
        const kData = db.keys[key];
        const uData = getUserData(userId);

        if (!kData || kData.assignedTo !== userId)
          return res.end(JSON.stringify({ valid: false, message: "Invalid key" }));

        if (Date.now() > kData.expiry)
          return res.end(JSON.stringify({ valid: false, message: "Key expired" }));

        if (uData.hwid && uData.hwid !== hwid)
          return res.end(JSON.stringify({ valid: false, message: "HWID mismatch" }));

        if (!uData.hwid) uData.hwid = hwid;

        uData.execs++;
        save();

        res.end(JSON.stringify({
          valid: true,
          message: "Authorized",
          execs: uData.execs,
          expiry: kData.expiry
        }));
      } catch {
        res.end(JSON.stringify({ valid: false, message: "Bad request" }));
      }
    });

    return;
  }

  res.end(JSON.stringify({ status: "API Online" }));
}).listen(PORT, () => {
  console.log(`[API] Running on ${PORT}`);
});

/* ================= START BOT ================= */
client.once("ready", async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Open panel")
      .addStringOption(o =>
        o.setName("type")
          .setRequired(true)
          .addChoices(
            { name: "admin", value: "admin" },
            { name: "customer", value: "customer" }
          )
      )
  ];

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  console.log("[BOT] Commands registered");
});

client.login(TOKEN);
