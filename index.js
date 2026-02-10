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
import fetch from "node-fetch";

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;      // Set your bot token in Replit secrets
const GUILD_ID = process.env.GUILD_ID;    // Set your guild ID in Replit secrets
const ADMIN_ROLE_ID = "1470621891600584744";
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
let db = { keys: {}, users: {}, blacklist: [], execLog: [] };
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const genKey = () => "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
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
  const userData = getUserData(interaction.user.id);
  const embed = new EmbedBuilder()
    .setTitle("CWUV Customer Panel")
    .setDescription("Redeem key, reset HWID, or submit bug/suggestion")
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
    createButton("Report Bug/Suggestion", "reportBug")
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

    // ---------- MODAL PROMPTS ----------
    if (["forceAssign","addTime","resetExecs","blacklistUser","revokeKey"].includes(id)) {
      const modal = new ModalBuilder().setCustomId(id+"_modal").setTitle(id);
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("key_or_user")
          .setLabel("Enter key or user ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ));
      if (id === "addTime") {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("extra")
            .setLabel("Time to add (ms)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ));
      }
      return interaction.showModal(modal);
    }

    // ---------- CUSTOMER BUTTONS ----------
    if (id === "redeemKey") {
      return interaction.reply({ content: "Send your key in chat: `!redeem <KEY>`", ephemeral: true });
    }
    if (id === "resetHWIDCustomer") {
      const last = userData.lastHWIDReset || 0;
      if (now()-last<24*60*60*1000) return interaction.reply({ content: "You can only reset HWID once every 24h.", ephemeral: true });
      userData.hwid=null;
      userData.lastHWIDReset=now();
      save();
      return interaction.reply({ content: "Your HWID has been reset.", ephemeral: true });
    }
    if (id === "reportBug") {
      const modal = new ModalBuilder().setCustomId("bugModal").setTitle("Submit Bug/Suggestion");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("bugText")
          .setLabel("Describe your bug or suggestion")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      ));
      return interaction.showModal(modal);
    }
  }

  // ---------- MODAL SUBMIT ----------
  if (interaction.isModalSubmit()) {
    const modalId = interaction.customId.replace("_modal","");
    const values = interaction.fields.fields;
    const keyOrUser = values.get("key_or_user")?.value;
    const extra = values.get("extra")?.value;

    if (modalId === "bugModal") {
      const bugText = values.get("bugText").value;
      // Log bug
      console.log(`Bug/Suggestion from ${interaction.user.tag}: ${bugText}`);
      return interaction.reply({ content: "Bug/suggestion submitted!", ephemeral: true });
    }

    const memberRoles = interaction.member.roles.cache;
    const isFounder = memberRoles.has(FOUNDER_ROLE_ID);
    const isAdmin = memberRoles.has(ADMIN_ROLE_ID);

    if (modalId === "forceAssign") {
      if (!db.keys[keyOrUser]) return interaction.reply({ content:"Key not found", ephemeral:true });
      db.keys[keyOrUser].assignedTo = extra || interaction.user.id;
      const uData = getUserData(extra||interaction.user.id);
      uData.key = keyOrUser;
      save();
      return interaction.reply({ content:`Key ${keyOrUser} assigned to <@${extra||interaction.user.id}>`, ephemeral:true });
    }

    if (modalId === "addTime") {
      if (!db.keys[keyOrUser]) return interaction.reply({ content:"Key not found", ephemeral:true });
      db.keys[keyOrUser].expiry = (db.keys[keyOrUser].expiry||now()) + Number(extra);
      save();
      return interaction.reply({ content:`Added ${extra}ms to key ${keyOrUser}`, ephemeral:true });
    }

    if (modalId === "resetExecs") {
      const uData = getUserData(keyOrUser);
      uData.execs=0;
      save();
      return interaction.reply({ content:`Executions reset for <@${keyOrUser}>`, ephemeral:true });
    }

    if (modalId === "blacklistUser") {
      db.blacklist.push(keyOrUser);
      save();
      return interaction.reply({ content:`User <@${keyOrUser}> blacklisted`, ephemeral:true });
    }

    if (modalId === "revokeKey") {
      // logic handled as before
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

      // Log execution
      db.execLog.push({
        user: msg.author.id,
        key,
        hwid: userData.hwid,
        time: now()
      });
      save();

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

/* ================= REPLIT PINGER ================= */
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("CWUV bot is running!"));
app.listen(PORT, () => console.log(`Pinger running on port ${PORT}`));
setInterval(() => {
  fetch(`http://localhost:${PORT}`).then(()=>console.log("Pinged self")).catch(console.log);
}, 5*60*1000);