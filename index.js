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
} from “discord.js”;
import fs from “fs”;
import crypto from “crypto”;
import http from “http”;

/* ================= CONFIG ================= */
const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 8080;

const ADMIN_ROLE_ID = “1470594684383395934”;
const CUSTOMER_ROLE_ID = “1470600210597282028”;
const FOUNDER_ROLE_ID = “1470595418080546848”;

// Use current directory instead of /app/data
const DATA_FILE = “./data.json”;

/* ================= DATA STORAGE ================= */
let db = { keys: {}, users: {}, blacklist: [], suggestions: [] };

// Load database
try {
if (fs.existsSync(DATA_FILE)) {
db = JSON.parse(fs.readFileSync(DATA_FILE, ‘utf8’));
console.log(“Database loaded”);
}
} catch (e) {
console.error(“Database load error:”, e.message);
}

const save = () => {
try {
fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
} catch (err) {
console.error(“Save error:”, err.message);
}
};

const genKey = (expiryDays = 30) => {
const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
const key = “CWUV-” + crypto.randomBytes(8).toString(“hex”).toUpperCase();
db.keys[key] = {
assignedTo: null,
expiry: Date.now() + expiryMs,
uses: 0
};
save();
return key;
};

function getUserData(userId) {
if (!db.users[userId]) {
db.users[userId] = {
hwid: null,
execs: 0,
key: null,
expiry: null,
lastHWIDReset: 0,
username: null
};
}
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
client.on(“interactionCreate”, async interaction => {
try {
const userId = interaction.user.id;
const userData = getUserData(userId);

```
if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
  const type = interaction.options.getString("type");
  if (type === "admin") {
    const embed = new EmbedBuilder().setTitle("Admin Panel").setColor("Red");
    const row1 = new ActionRowBuilder().addComponents(
      createButton("Gen Key", "genKey"), 
      createButton("View Keys", "viewKeys")
    );
    await interaction.reply({ embeds: [embed], components: [row1] });
  } else {
    const embed = new EmbedBuilder().setTitle("Customer Panel").setColor("Green");
    const row = new ActionRowBuilder().addComponents(
      createButton("Redeem Key", "redeemKey"), 
      createButton("Stats", "viewStats")
    );
    await interaction.reply({ embeds: [embed], components: [row] });
  }
}

if (interaction.isButton()) {
  if (interaction.customId === "genKey") {
    const key = genKey(30);
    await interaction.reply({ content: `Key: \`${key}\``, ephemeral: true });
  }

  if (interaction.customId === "viewKeys") {
    const keys = Object.keys(db.keys).slice(-10).join("\n") || "No keys";
    await interaction.reply({ content: `Keys:\n${keys}`, ephemeral: true });
  }

  if (interaction.customId === "redeemKey") {
    const modal = new ModalBuilder().setCustomId("redeemModal").setTitle("Redeem");
    const input = new TextInputBuilder()
      .setCustomId("keyInput")
      .setLabel("Key")
      .setStyle(TextInputStyle.Short);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }
  
  if (interaction.customId === "viewStats") {
    await interaction.reply({ 
      content: `Execs: ${userData.execs}\nKey: ${userData.key || "None"}`, 
      ephemeral: true 
    });
  }
}

if (interaction.isModalSubmit() && interaction.customId === "redeemModal") {
  const key = interaction.fields.getTextInputValue("keyInput").trim();
  
  if (!db.keys[key]) {
    return interaction.reply({ content: "Invalid Key", ephemeral: true });
  }
  
  if (db.keys[key].assignedTo) {
    return interaction.reply({ content: "Already Redeemed", ephemeral: true });
  }

  db.keys[key].assignedTo = userId;
  userData.key = key;
  userData.expiry = db.keys[key].expiry;
  save();
  
  await interaction.reply({ content: "Redeemed!", ephemeral: true });
}
```

} catch (err) {
console.error(“Interaction error:”, err.message);
}
});

/* ================= WEB API ================= */
http.createServer((req, res) => {
res.setHeader(“Content-Type”, “application/json”);
res.setHeader(“Access-Control-Allow-Origin”, “*”);

if (req.method === “OPTIONS”) {
res.writeHead(200);
return res.end();
}

if (req.url === “/” && req.method === “GET”) {
return res.end(JSON.stringify({ status: “online” }));
}

if (req.url === “/validate” && req.method === “POST”) {
let body = “”;

```
req.on("data", chunk => {
  body += chunk.toString();
});

req.on("end", () => {
  try {
    const { key, userId, username } = JSON.parse(body);
    
    console.log(`Validating: ${key} for ${username}`);

    if (!db.keys[key]) {
      console.log("Invalid key");
      return res.end(JSON.stringify({ valid: false, message: "Invalid key" }));
    }

    const keyData = db.keys[key];
    const userData = getUserData(userId);

    if (Date.now() > keyData.expiry) {
      console.log("Expired key");
      return res.end(JSON.stringify({ valid: false, message: "Key expired" }));
    }

    if (keyData.assignedTo && keyData.assignedTo !== userId) {
      console.log("Key bound to another user");
      return res.end(JSON.stringify({ valid: false, message: "Key bound to another user" }));
    }

    if (!keyData.assignedTo) {
      keyData.assignedTo = userId;
      console.log(`Auto-assigned key to ${username}`);
    }

    keyData.uses = (keyData.uses || 0) + 1;
    userData.key = key;
    userData.expiry = keyData.expiry;
    userData.username = username;
    userData.execs = (userData.execs || 0) + 1;
    
    save();

    console.log(`Key validated for ${username}`);

    res.end(JSON.stringify({ 
      valid: true, 
      message: "Key validated successfully!"
    }));

  } catch (error) {
    console.error("Validation error:", error.message);
    res.end(JSON.stringify({ valid: false, message: "Server error" }));
  }
});
```

} else {
res.writeHead(404);
res.end(JSON.stringify({ error: “Not Found” }));
}

}).listen(PORT, () => {
console.log(`API running on port ${PORT}`);
});

client.once(“ready”, async () => {
console.log(`Bot online: ${client.user.tag}`);

const rest = new REST({ version: “10” }).setToken(TOKEN);
const commands = [
new SlashCommandBuilder()
.setName(“setup”)
.setDescription(“Panel”)
.addStringOption(o =>
o.setName(“type”)
.setRequired(true)
.addChoices(
{name:“admin”,value:“admin”},
{name:“customer”,value:“customer”}
)
)
];

try {
await rest.put(
Routes.applicationGuildCommands(client.user.id, GUILD_ID),
{ body: commands }
);
console.log(“Commands registered”);
} catch (error) {
console.error(“Command registration error:”, error.message);
}
});

client.login(TOKEN).catch(err => {
console.error(“Login error:”, err.message);
});

console.log(“Starting…”);
