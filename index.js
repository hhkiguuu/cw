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
import express from "express";

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ADMIN_ROLE_ID = "1470621891600584744";
const CUSTOMER_ROLE_ID = "1470600210597282028";
const FOUNDER_ROLE_ID = "1470595418080546848";
const DATA_FILE = "./data.json";

/* ================= EXPRESS PINGER ================= */
const app = express();
const PORT = process.env.PORT || 8080;
app.get("/", (req, res) => res.send("Pinger running"));
app.listen(PORT, () => console.log(`Pinger running on port ${PORT}`));

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
    createButton("Reset User Executions", "resetExecs"),
    createButton("Blacklist User", "blacklistUser"),
    createButton("Revoke Key", "revokeKey")
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: false });
}

async function sendCustomerPanel(interaction) {
  const userData = getUserData(interaction.user.id);
  const embed = new EmbedBuilder()
    .setTitle("CWUV Customer Panel")
    .setDescription("Redeem key and manage your account")
    .setColor("Green")
    .addFields(
      { name: "Key", value: userData.key || "None", inline: true },
      { name: "Expiry", value: userData.expiry ? new Date(userData.expiry).toLocaleString() : "None", inline: true },
      { name: "Executions", value: userData.execs.toString(), inline: true },
      { name: "HWID", value: userData.hwid || "None", inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    createButton("Redeem Key", "redeemKey"),
    createButton("Reset HWID", "resetHWIDCustomer"),
    createButton("Submit Bug/Feedback", "customerReport")
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
      const key = genKey();
      db.keys[key] = { assignedTo: null, expiry: null };
      save();
      return interaction.reply({ content: `Generated key: **${key}**`, ephemeral: true });
    }

    if (id === "viewKeys") {
      const keyText = Object.entries(db.keys)
        .map(([k,v]) => `${k} → ${v.assignedTo || "Unassigned"} | Expiry: ${v.expiry?new Date(v.expiry).toLocaleString():"None"}`)
        .join("\n") || "No keys";
      const embed = new EmbedBuilder().setTitle("All Keys").setColor("Orange").setDescription(keyText);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (id === "viewUsers") {
      const userText = Object.entries(db.users)
        .map(([u,d]) => {
          const expiryText = d.expiry ? new Date(d.expiry).toLocaleString() : "None";
          const hwidText = d.hwid || "None";
          const keyText = d.key || "None";
          return `<@${u}> → Key: ${keyText} | Execs: ${d.execs} | HWID: ${hwidText} | Expiry: ${expiryText}`;
        })
        .join("\n") || "No users";
      const embed = new EmbedBuilder().setTitle("All Users").setColor("Orange").setDescription(userText);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ---------- CUSTOMER BUTTONS ----------
    if (id === "redeemKey") return interaction.reply({ content: "Send your key in chat: `!redeem <KEY>`", ephemeral: true });

    if (id === "resetHWIDCustomer") {
      const last = userData.lastHWIDReset || 0;
      if (now()-last<24*60*60*1000) return interaction.reply({ content: "You can only reset HWID once every 24h.", ephemeral: true });
      userData.hwid=null;
      userData.lastHWIDReset=now();
      save();
      return interaction.reply({ content: "Your HWID has been reset.", ephemeral: true });
    }

    if (id === "customerReport") {
      const modal = new ModalBuilder().setCustomId("customerReport_modal").setTitle("Bug/Feedback Report");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reportContent")
          .setLabel("Your report or suggestion")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ));
      return interaction.showModal(modal);
    }
  }

  // ---------- MODAL SUBMIT ----------
  if (interaction.isModalSubmit()) {
    const modalId = interaction.customId;
    const values = interaction.fields.fields;

    if (modalId === "customerReport_modal") {
      const report = values.get("reportContent")?.value;
      console.log(`Customer report from ${interaction.user.tag}: ${report}`);
      return interaction.reply({ content: "Report submitted, thank you!", ephemeral: true });
    }
  }
});

/* ================= MESSAGE HANDLING ================= */
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const content = msg.content.trim();

  if (content.startsWith("!redeem")) {
    const key = content.split(" ")[1];
    if (db.blacklist.includes(msg.author.id)) return msg.reply("You are blacklisted.");
    if (db.keys[key] && !db.keys[key].assignedTo) {
      db.keys[key].assignedTo = msg.author.id;
      const userData = getUserData(msg.author.id);
      userData.key = key;
      userData.expiry = db.keys[key].expiry||now()+30*24*60*60*1000;
      save();
      const member = await msg.guild.members.fetch(msg.author.id);
      if (member && CUSTOMER_ROLE_ID) member.roles.add(CUSTOMER_ROLE_ID);
      return msg.reply("Key redeemed successfully! Customer role assigned.");
    } else return msg.reply("Invalid or already redeemed key.");
  }
});

/* ================= LOGIN ================= */
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await deployCommands();
});

client.login(TOKEN);
