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
    console.error("Error loading DB");
  }
}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const genKey = (expiryMs = 30*24*60*60*1000) => {
  const key = "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  db.keys[key] = { assignedTo: null, expiry: Date.now() + expiryMs };
  save();
  return key;
};

const now = () => Date.now();

function getUserData(userId) {
  if (!db.users[userId])
    db.users[userId] = { hwid: null, execs: 0, key: null, expiry: null, lastHWIDReset: 0 };
  return db.users[userId];
}

/* ================= CLIENT ================= */
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

async function sendAdminPanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("CWUV Admin Panel")
    .setDescription("Admin actions — only admins/founders can interact")
    .setColor("Red");

  const row1 = new ActionRowBuilder().addComponents(
    createButton("Generate Key", "genKey"),
    createButton("View Keys", "viewKeys"),
    createButton("View Users", "viewUsers"),
    createButton("Force Assign Key", "forceAssign"),
    createButton("Add Time to Key", "addTime")
  );
  const row2 = new ActionRowBuilder().addComponents(
    createButton("Reset Execs", "resetExecs"),
    createButton("Blacklist User", "blacklistUser"),
    createButton("Revoke Key", "revokeKey")
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: false });
}

async function sendCustomerPanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("CWUV Customer Panel")
    .setDescription("Manage your account and redeem keys")
    .setColor("Green");

  const row = new ActionRowBuilder().addComponents(
    createButton("Redeem Key", "redeemKey"),
    createButton("View Stats", "viewStats"),
    createButton("Reset HWID", "resetHWIDCustomer"),
    createButton("Suggestions/Bugs", "suggestModal")
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
}

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setup") {
        const type = interaction.options.getString("type");
        if (type === "admin") await sendAdminPanel(interaction);
        else await sendCustomerPanel(interaction);
    }
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    const memberRoles = interaction.member.roles.cache;
    const isAdmin = memberRoles.has(ADMIN_ROLE_ID);
    const isFounder = memberRoles.has(FOUNDER_ROLE_ID);
    const userId = interaction.user.id;
    const userData = getUserData(userId);

    if (["genKey","viewKeys","viewUsers","forceAssign","addTime","resetExecs","blacklistUser","revokeKey"].includes(id)) {
      if (!isAdmin && !isFounder)
        return interaction.reply({ content: "Only admins/founders can use this.", ephemeral: true });
    }

    if (id === "genKey") {
      const key = genKey();
      return interaction.reply({ content: `Generated key: **${key}**`, ephemeral: true });
    }

    if (id === "viewKeys") {
      const keyText = Object.entries(db.keys)
        .map(([k,v]) => `${k} → ${v.assignedTo || "Unassigned"} | Expiry: ${v.expiry ? new Date(v.expiry).toLocaleString() : "None"}`)
        .join("\n") || "No keys";
      const embed = new EmbedBuilder().setTitle("All Keys").setColor("Orange").setDescription(keyText.substring(0, 4000));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (id === "redeemKey") {
      const modal = new ModalBuilder()
        .setTitle("Redeem Key")
        .setCustomId("redeemKeyModal")
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("key").setLabel("Enter your key").setStyle(TextInputStyle.Short).setRequired(true)
        ));
      return interaction.showModal(modal);
    }

    if (id === "viewStats") {
      const embed = new EmbedBuilder()
        .setTitle("Your Stats")
        .addFields(
          { name: "Key", value: userData.key||"None", inline:true },
          { name: "Expiry", value: userData.expiry ? new Date(userData.expiry).toLocaleString() : "None", inline:true },
          { name: "Executions", value: userData.execs.toString(), inline:true },
          { name: "HWID", value: userData.hwid||"None", inline:false }
        ).setColor("Blue");
      return interaction.reply({ embeds:[embed], ephemeral:true });
    }

    if (id === "resetHWIDCustomer") {
      if (now()-userData.lastHWIDReset < 24*60*60*1000)
        return interaction.reply({ content: "You can only reset HWID once every 24h.", ephemeral:true });
      userData.hwid = null;
      userData.lastHWIDReset = now();
      save();
      return interaction.reply({ content: "Your HWID has been reset.", ephemeral:true });
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === "redeemKeyModal") {
      const key = interaction.fields.getTextInputValue("key").trim();
      const uData = getUserData(interaction.user.id);
      if (!db.keys[key]) return interaction.reply({ content:"Invalid key", ephemeral:true });
      if (db.keys[key].assignedTo) return interaction.reply({ content:"Key already redeemed", ephemeral:true });

      db.keys[key].assignedTo = interaction.user.id;
      uData.key = key;
      uData.expiry = db.keys[key].expiry;
      save();

      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (member && CUSTOMER_ROLE_ID) member.roles.add(CUSTOMER_ROLE_ID).catch(()=>{});
      await interaction.reply({ content:"Key redeemed successfully!", ephemeral:true });
    }
  }
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
            return res.end(JSON.stringify({ valid: false, message: "Key not found or not assigned to you." }));
        }

        if (userData.hwid && userData.hwid !== hwid) {
            return res.end(JSON.stringify({ valid: false, message: "HWID Mismatch! Reset via Discord." }));
        }

        if (!userData.hwid) { userData.hwid = hwid; save(); }
        userData.execs++;
        save();
        res.end(JSON.stringify({ valid: true, message: "Authenticated!" }));
      } catch (e) {
        res.end(JSON.stringify({ valid: false, message: "API Error" }));
      }
    });
  } else {
    res.end("Pinger running - Bot & API Online");
  }
});

/* ================= STARTUP ================= */
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    const commands = [
      new SlashCommandBuilder().setName("setup").setDescription("Show admin or customer panel")
      .addStringOption(o => o.setName("type").setDescription("admin or customer").setRequired(true)
      .addChoices({ name: "admin", value: "admin" }, { name: "customer", value: "customer" }))
    ].map(c => c.toJSON());

    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log("Commands synced.");
  } catch (err) {
    console.error(err);
  }
});

server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
client.login(TOKEN);
