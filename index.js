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
  Routes,
  InteractionResponseFlags
} from "discord.js";
import fs from "fs";
import crypto from "crypto";

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1470600210597282028";       // Replace with your admin role ID
const CUSTOMER_ROLE_ID = "1470600210597282028"; // Replace with your customer role ID
const FOUNDER_ROLE_ID = "1470595418080546848";   // Replace with your founder role ID
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

const genKey = () => "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
const now = () => Date.now();

function getUserData(userId) {
  if (!db.users[userId])
    db.users[userId] = { hwid: null, execs: 0, key: null, expiry: null, lastHWIDReset: 0 };
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

/* Admin panel split into multiple rows (max 5 buttons per row) */
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
    createButton("Add Time", "addTime")
  );

  const row2 = new ActionRowBuilder().addComponents(
    createButton("Reset Execs", "resetExecs"),
    createButton("Blacklist User", "blacklistUser"),
    createButton("Revoke Key", "revokeKey")
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2], flags: InteractionResponseFlags.Ephemeral });
}

async function sendCustomerPanel(interaction) {
  const userData = getUserData(interaction.user.id);
  const embed = new EmbedBuilder()
    .setTitle("CWUV Customer Panel")
    .setDescription("Redeem keys and manage your account")
    .setColor("Green");

  const row = new ActionRowBuilder().addComponents(
    createButton("Redeem Key", "redeemKey"),
    createButton("Reset HWID", "resetHWIDCustomer"),
    createButton("Bug / Suggestion", "bugReport")
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: InteractionResponseFlags.Ephemeral });
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

    // Admin-only buttons
    if (["genKey","viewKeys","viewUsers","forceAssign","addTime","resetExecs","blacklistUser","revokeKey"].includes(id)) {
      if (!isAdmin && !isFounder)
        return interaction.reply({ content: "Only admins or founders can use this.", flags: InteractionResponseFlags.Ephemeral });
    }

    // ----------------- GEN / VIEW -----------------
    if (id === "genKey") {
      const key = genKey();
      db.keys[key] = { assignedTo: null, expiry: now()+30*24*60*60*1000 }; // default 30 days
      save();
      return interaction.reply({ content: `Generated key: **${key}**`, flags: InteractionResponseFlags.Ephemeral });
    }

    if (id === "viewKeys") {
      const keyText = Object.entries(db.keys)
        .map(([k,v]) => `${k} → ${v.assignedTo || "Unassigned"} | Expiry: ${v.expiry?new Date(v.expiry).toLocaleString():"None"}`)
        .join("\n") || "No keys";
      const embed = new EmbedBuilder().setTitle("All Keys").setColor("Orange").setDescription(keyText);
      return interaction.reply({ embeds: [embed], flags: InteractionResponseFlags.Ephemeral });
    }

    if (id === "viewUsers") {
      const userText = Object.entries(db.users)
        .map(([u,d]) => {
          const expiryText = d.expiry ? new Date(d.expiry).toLocaleString() : "None";
          const hwidText = d.hwid || "None";
          const keyText = d.key || "None";
          return `<@${u}> → Key: ${keyText} | Execs: ${d.execs} | HWID: ${hwidText} | Expiry: ${expiryText}`;
        }).join("\n") || "No users";
      const embed = new EmbedBuilder().setTitle("All Users").setColor("Orange").setDescription(userText);
      return interaction.reply({ embeds: [embed], flags: InteractionResponseFlags.Ephemeral });
    }

    // ----------------- Customer buttons -----------------
    if (id === "redeemKey") {
      const modal = new ModalBuilder()
        .setTitle("Redeem Key")
        .setCustomId("redeemKey_modal")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("redeemInput")
              .setLabel("Enter your key")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    if (id === "resetHWIDCustomer") {
      if (now()-userData.lastHWIDReset<24*60*60*1000)
        return interaction.reply({ content:"You can only reset HWID once every 24h.", flags: InteractionResponseFlags.Ephemeral });
      userData.hwid = null;
      userData.lastHWIDReset = now();
      save();
      return interaction.reply({ content:"HWID has been reset.", flags: InteractionResponseFlags.Ephemeral });
    }

    if (id === "bugReport") {
      const modal = new ModalBuilder()
        .setTitle("Bug / Suggestion")
        .setCustomId("bugReport_modal")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("bugInput")
              .setLabel("Describe bug or suggestion")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }
  }

  // ----------------- MODAL SUBMIT -----------------
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "redeemKey_modal") {
      const key = interaction.fields.getTextInputValue("redeemInput").trim();
      if (!db.keys[key]) return interaction.reply({ content:"Invalid key.", flags: InteractionResponseFlags.Ephemeral });
      if (db.keys[key].assignedTo) return interaction.reply({ content:"Key already redeemed.", flags: InteractionResponseFlags.Ephemeral });

      db.keys[key].assignedTo = userId;
      const uData = getUserData(userId);
      uData.key = key;
      uData.expiry = db.keys[key].expiry || now()+30*24*60*60*1000;

      const member = await interaction.guild.members.fetch(userId);
      if (member) member.roles.add(CUSTOMER_ROLE_ID);
      save();
      return interaction.reply({ content:"Key redeemed successfully!", flags: InteractionResponseFlags.Ephemeral });
    }

    if (interaction.customId === "bugReport_modal") {
      const report = interaction.fields.getTextInputValue("bugInput").trim();
      console.log(`[CW Bug Report] ${interaction.user.tag}: ${report}`);
      return interaction.reply({ content:"Report sent!", flags: InteractionResponseFlags.Ephemeral });
    }
  }
});

/* ================= MESSAGE REDEEM ================= */
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.content.startsWith("!redeem")) {
    const key = msg.content.split(" ")[2] or msg.content.split(" ")[1]
    if (!db.keys[key]) return msg.reply("Invalid key.");
    if (db.keys[key].assignedTo) return msg.reply("Key already redeemed.");

    db.keys[key].assignedTo = msg.author.id;
    const uData = getUserData(msg.author.id);
    uData.key = key;
    uData.expiry = db.keys[key].expiry || now()+30*24*60*60*1000;

    const member = await msg.guild.members.fetch(msg.author.id);
    if (member) member.roles.add(CUSTOMER_ROLE_ID);
    save();
    msg.reply("Key redeemed successfully!");
  }
});

/* ================= LOGIN ================= */
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await deployCommands();
});

client.login(TOKEN);
