import { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes } from "discord.js";
import express from "express";
import fs from "fs";
import crypto from "crypto";

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1452072325485691047"; // <-- DM logs go here
const ADMIN_ROLE_ID = "1470621891600584744";
const CUSTOMER_ROLE_ID = "1470600210597282028";
const FOUNDER_ROLE_ID = "1470595418080546848";
const DATA_FILE = "./data.json";

/* ================= EXPRESS SERVER / PINGER ================= */
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8080;
app.get("/", (req,res)=>res.send("Pinger running"));
app.listen(PORT, ()=>console.log(`Pinger running on port ${PORT}`));

/* ================ DATA STORAGE ================= */
let db = { keys:{}, users:{}, blacklist: [] };
if(fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));
const save = ()=>fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2));
const genKey = ()=> "CWUV-"+crypto.randomBytes(8).toString("hex").toUpperCase();
const now = ()=>Date.now();
function getUserData(userId){
  if(!db.users[userId]) db.users[userId] = { hwid:null, execs:0, key:null, expiry:null, lastHWIDReset:0 };
  return db.users[userId];
}

/* ================ CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

/* ================ SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Show admin or customer panel")
    .addStringOption(o=>o.setName("type").setDescription("admin or customer").setRequired(true)
      .addChoices({name:"admin",value:"admin"},{name:"customer",value:"customer"}))
].map(c=>c.toJSON());

const rest = new REST({version:"10"}).setToken(TOKEN);
async function deployCommands(){await rest.put(Routes.applicationGuildCommands(client.user.id,GUILD_ID),{body:commands});console.log("Slash commands deployed");}

/* ================== PANEL HELPERS ================== */
function createButton(label,customId,style=ButtonStyle.Primary){return new ButtonBuilder().setLabel(label).setCustomId(customId).setStyle(style);}
async function sendAdminPanel(interaction){
  const embed = new EmbedBuilder().setTitle("CWUV Admin Panel").setDescription("Admin actions — only admins/founders can interact").setColor("Red");
  const row = new ActionRowBuilder().addComponents(
    createButton("Generate Key","genKey"),
    createButton("View Keys","viewKeys"),
    createButton("View Users","viewUsers"),
    createButton("Force Assign Key","forceAssign"),
    createButton("Add Time to Key","addTime"),
    createButton("Reset User Executions","resetExecs"),
    createButton("Blacklist User","blacklistUser"),
    createButton("Revoke Key","revokeKey")
  );
  await interaction.reply({embeds:[embed],components:[row],ephemeral:false});
}
async function sendCustomerPanel(interaction){
  const embed = new EmbedBuilder().setTitle("CWUV Customer Panel").setDescription("Click buttons to view stats or redeem keys").setColor("Green");
  const row = new ActionRowBuilder().addComponents(
    createButton("Redeem Key","redeemKey"),
    createButton("View Stats","viewStats"),
    createButton("Report / Suggest","reportBug"),
    createButton("Reset HWID","resetHWIDCustomer")
  );
  await interaction.reply({embeds:[embed],components:[row],ephemeral:false});
}

/* ================ INTERACTIONS ================= */
client.on("interactionCreate",async interaction=>{
  if(interaction.isChatInputCommand()){
    const type = interaction.options.getString("type");
    if(type==="admin") await sendAdminPanel(interaction);
    else await sendCustomerPanel(interaction);
  }

  if(interaction.isButton()){
    const id = interaction.customId;
    const userId = interaction.user.id;
    const member = interaction.member;
    const userData = getUserData(userId);
    const roles = member.roles.cache;
    const isAdmin = roles.has(ADMIN_ROLE_ID);
    const isFounder = roles.has(FOUNDER_ROLE_ID);

    // ---------- ADMIN BUTTONS ----------
    if(["genKey","viewKeys","viewUsers","forceAssign","addTime","resetExecs","blacklistUser","revokeKey"].includes(id)){
      if(!isAdmin&&!isFounder) return interaction.reply({content:"Only admins/founders can use this.",ephemeral:true});
    }

    // Generate Key modal with optional expiry
    if(id==="genKey"){
      const modal = new ModalBuilder().setCustomId("genKey_modal").setTitle("Generate Key");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("expiry_input").setLabel("Expiry (hours, optional)").setStyle(TextInputStyle.Short).setRequired(false)
      ));
      return interaction.showModal(modal);
    }

    // Admin view buttons
    if(id==="viewKeys"){
      const kTxt = Object.entries(db.keys).map(([k,v])=>`${k} → ${v.assignedTo||"Unassigned"} | Expiry: ${v.expiry?new Date(v.expiry).toLocaleString():"None"}`).join("\n")||"No keys";
      return interaction.reply({embeds:[new EmbedBuilder().setTitle("All Keys").setColor("Orange").setDescription(kTxt)],ephemeral:true});
    }
    if(id==="viewUsers"){
      const uTxt = Object.entries(db.users).map(([u,d])=>`<@${u}> → Key: ${d.key||"None"} | Execs: ${d.execs} | HWID: ${d.hwid||"None"} | Expiry: ${d.expiry?new Date(d.expiry).toLocaleString():"None"}`).join("\n")||"No users";
      return interaction.reply({embeds:[new EmbedBuilder().setTitle("All Users").setColor("Orange").setDescription(uTxt)],ephemeral:true});
    }

    // Customer buttons
    if(id==="redeemKey"){
      const modal = new ModalBuilder().setCustomId("redeem_modal").setTitle("Redeem Key");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("redeem_input").setLabel("Enter Key").setStyle(TextInputStyle.Short).setRequired(true)));
      return interaction.showModal(modal);
    }
    if(id==="viewStats"){
      const embed = new EmbedBuilder().setTitle("Your Stats").setColor("Blue")
        .addFields(
          {name:"Key",value:userData.key||"None",inline:true},
          {name:"Expiry",value:userData.expiry?new Date(userData.expiry).toLocaleString():"None",inline:true},
          {name:"Executions",value:userData.execs.toString(),inline:true},
          {name:"HWID",value:userData.hwid||"None",inline:false}
        );
      return interaction.reply({embeds:[embed],ephemeral:true});
    }
    if(id==="resetHWIDCustomer"){
      const last=userData.lastHWIDReset||0;
      if(now()-last<24*60*60*1000) return interaction.reply({content:"You can only reset HWID once every 24h.",ephemeral:true});
      userData.hwid=null; userData.lastHWIDReset=now(); save();
      return interaction.reply({content:"Your HWID has been reset.",ephemeral:true});
    }
    if(id==="reportBug"){
      const modal = new ModalBuilder().setCustomId("report_modal").setTitle("Report / Suggest");
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("report_input").setLabel("Describe your bug or suggestion").setStyle(TextInputStyle.Paragraph).setRequired(true)));
      return interaction.showModal(modal);
    }
  }

  // MODAL SUBMITS
  if(interaction.isModalSubmit()){
    const id = interaction.customId;
    const roles = interaction.member.roles.cache;
    const isAdmin = roles.has(ADMIN_ROLE_ID);
    const isFounder = roles.has(FOUNDER_ROLE_ID);

    // ---------- GENERATE KEY ----------
    if(id==="genKey_modal"){
      let expiryHours = interaction.fields.getTextInputValue("expiry_input");
      const key = genKey();
      let expiryTimestamp = null;
      if(expiryHours){
        const hours = Number(expiryHours);
        if(!isNaN(hours)&&hours>0) expiryTimestamp = now()+hours*60*60*1000;
      }
      db.keys[key]={assignedTo:null,expiry:expiryTimestamp};
      save();
      return interaction.reply({content:`Generated key: **${key}**${expiryTimestamp?` | Expires in ${expiryHours}h`:" | No expiry set"}`,ephemeral:true});
    }

    // ---------- REDEEM KEY ----------
    if(id==="redeem_modal"){
      const key = interaction.fields.getTextInputValue("redeem_input").trim();
      const uData = getUserData(interaction.user.id);

      if(db.blacklist.includes(interaction.user.id)) return interaction.reply({content:"You are blacklisted.",ephemeral:true});
      if(db.keys[key] && !db.keys[key].assignedTo){
        db.keys[key].assignedTo = interaction.user.id;
        uData.key = key;
        uData.expiry = db.keys[key].expiry||now()+30*24*60*60*1000;
        save();

        const member = await interaction.guild.members.fetch(interaction.user.id);
        if(member && CUSTOMER_ROLE_ID) member.roles.add(CUSTOMER_ROLE_ID);

        const owner = await client.users.fetch(OWNER_ID).catch(()=>null);
        if(owner) owner.send(`🟢 Key redeemed\nUser: <@${interaction.user.id}>\nKey: ${key}\nHWID: ${uData.hwid||"None"}\nTime: ${new Date().toLocaleString()}`);

        await interaction.reply({content:"Key redeemed successfully!",ephemeral:false});
        setTimeout(()=>interaction.deleteReply().catch(()=>{}),3000);
        return;
      } else {
        const owner = await client.users.fetch(OWNER_ID).catch(()=>null);
        if(owner) owner.send(`🔴 Failed redeem attempt\nUser: <@${interaction.user.id}>\nKey: ${key}\nTime: ${new Date().toLocaleString()}`);
        return interaction.reply({content:"Invalid or already redeemed key.",ephemeral:true});
      }
    }

    // ---------- REPORT BUG ----------
    if(id==="report_modal"){
      const text = interaction.fields.getTextInputValue("report_input").trim();
      const owner = await client.users.fetch(OWNER_ID).catch(()=>null);
      if(owner) owner.send(`💡 Bug / Suggestion\nFrom: <@${interaction.user.id}>\nMessage: ${text}\nTime: ${new Date().toLocaleString()}`);
      return interaction.reply({content:"Report sent!",ephemeral:true});
    }
  }
});

/* ================= LOGIN ================= */
client.once("ready",async ()=>{
  console.log(`Logged in as ${client.user.tag}`);
  await deployCommands();
});

client.login(TOKEN);
