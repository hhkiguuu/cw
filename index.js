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

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1470594684383395934";
const CUSTOMER_ROLE_ID = "1470600210597282028";
const FOUNDER_ROLE_ID = "1470595418080546848";
const DATA_FILE = "./data.json";

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

/* ================= DATA STORAGE ================= */
let db = { keys: {}, users: {}, blacklist: [] };
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const genKey = (expiryMs) => {
  const key = "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  db.keys[key] = { assignedTo: null, expiry: expiryMs ? Date.now() + expiryMs : null };
  save();
  return key;
};

const now = () => Date.now();

function getUserData(userId) {
  if (!db.users[userId])
    db.users[userId] = {
      hwid: null,
      execs: 0,
      key: null,
      expiry: null,
      lastHWIDReset: 0
    };
  return db.users[userId];
}

/* ================= SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Show admin or customer panel")
    .addStringOption(o =>
      o.setName("type")
        .setDescription("admin or customer")
        .setRequired(true)
        .addChoices(
          { name: "admin", value: "admin" },
          { name: "customer", value: "customer" }
        )
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);
async function deployCommands() {
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("Slash commands deployed");
}

/* ================= PANEL HELPERS ================= */
function createButton(label, customId, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setLabel(label).setCustomId(customId).setStyle(style);
}

async function sendAdminPanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("CWUV Admin Panel")
    .setDescription("Admin actions — only admins/founders can interact")
    .setColor("Red");

  const row = new ActionRowBuilder().addComponents(
    createButton("Generate Key", "genKey"),
    createButton("View Keys", "viewKeys"),
    createButton("View Users", "viewUsers"),
    createButton("Force Assign Key", "forceAssign"),
    createButton("Add Time to Key", "addTime"),
    createButton("Reset User Executions", "resetExecs"),
    createButton("Blacklist User", "blacklistUser"),
    createButton("Revoke Key", "revokeKey")
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
}

async function sendCustomerPanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("CWUV Customer Panel")
    .setDescription("Use buttons to view stats or redeem key")
    .setColor("Green");

  const row = new ActionRowBuilder().addComponents(
    createButton("Redeem Key", "redeemKey"),
    createButton("View Stats", "viewStats"),
    createButton("Submit Suggestion / Bug", "submitBug")
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
}

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    const type = interaction.options.getString("type");
    if (type === "admin") await sendAdminPanel(interaction);
    else await sendCustomerPanel(interaction);
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    const userId = interaction.user.id;
    const member = interaction.member;
    const userData = getUserData(userId);
    const memberRoles = member.roles.cache;
    const isFounder = memberRoles.has(FOUNDER_ROLE_ID);
    const isAdmin = memberRoles.has(ADMIN_ROLE_ID);

    // ---------- ADMIN/FINDER BUTTONS ----------
    if (["genKey","viewKeys","viewUsers","forceAssign","addTime","resetExecs","blacklistUser","revokeKey"].includes(id)) {
      if (!isAdmin && !isFounder)
        return interaction.reply({ content: "Only admins or founders can use this.", ephemeral: true });
    }

    // ----------- GEN / VIEW ---------
    if (id === "genKey") {
      const modal = new ModalBuilder()
        .setCustomId("genKey_modal")
        .setTitle("Generate Key");

      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("expiryMs")
          .setLabel("Expiry in ms (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ));

      return interaction.showModal(modal);
    }

    if (id === "viewKeys") {
      const keyText = Object.entries(db.keys)
        .map(([k,v]) => `${k} → ${v.assignedTo || "Unassigned"} | Expiry: ${v.expiry?new Date(v.expiry).toLocaleString():"None"}`)
        .join("\n") || "No keys";
      const embed = new EmbedBuilder().setTitle("All Keys").setColor("Orange").setDescription(keyText);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (id === "viewStats") {
      const userData = getUserData(userId);
      const embed = new EmbedBuilder()
        .setTitle("Your Stats")
        .addFields(
          { name: "Key", value: userData.key || "None", inline: true },
          { name: "Expiry", value: userData.expiry ? new Date(userData.expiry).toLocaleString() : "None", inline: true },
          { name: "Executions", value: userData.execs.toString(), inline: true },
          { name: "HWID", value: userData.hwid || "None", inline: false }
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (id === "redeemKey") {
      const modal = new ModalBuilder()
        .setCustomId("redeemKey_modal")
        .setTitle("Redeem Key");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("redeemKey_input")
          .setLabel("Enter your key")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ));
      return interaction.showModal(modal);
    }

    if (id === "submitBug") {
      const modal = new ModalBuilder()
        .setCustomId("bug_modal")
        .setTitle("Submit Suggestion / Bug");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("bug_input")
          .setLabel("Enter suggestion / bug")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ));
      return interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    const modalId = interaction.customId;
    const values = interaction.fields.fields;

    if (modalId === "redeemKey_modal") {
      const key = values.get("redeemKey_input").value;
      if (db.keys[key] && !db.keys[key].assignedTo) {
        db.keys[key].assignedTo = userId;
        const uData = getUserData(userId);
        uData.key = key;
        uData.expiry = db.keys[key].expiry || now() + 30*24*60*60*1000;
        save();
        const member = await interaction.guild.members.fetch(userId);
        if (member && CUSTOMER_ROLE_ID) member.roles.add(CUSTOMER_ROLE_ID);
        return interaction.reply({ content: "✅ Key redeemed successfully!", ephemeral: true });
      } else {
        return interaction.reply({ content: "❌ Invalid or already redeemed key.", ephemeral: true });
      }
    }

    if (modalId === "genKey_modal") {
      const expiry = values.get("expiryMs").value;
      const key = genKey(expiry ? Number(expiry) : null);
      return interaction.reply({ content: `✅ Generated key: **${key}**`, ephemeral: true });
    }

    if (modalId === "bug_modal") {
      const bugText = values.get("bug_input").value;
      // just print in console, not webhook
      console.log(`[CWUV BUG REPORT] ${interaction.user.tag}: ${bugText}`);
      return interaction.reply({ content: "✅ Bug / suggestion submitted.", ephemeral: true });
    }
  }
});

/* ================= LOGIN ================= */
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await deployCommands();
});

client.login(TOKEN);
