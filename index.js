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
const DATA_FILE = “/app/data/data.json”; // Optimized for Railway Volumes

/* ================= DATA STORAGE ================= */
// Ensure directory exists for Railway Volumes
if (!fs.existsSync(”/app/data”)) fs.mkdirSync(”/app/data”, { recursive: true });

let db = { keys: {}, users: {}, blacklist: [], suggestions: [] };

if (fs.existsSync(DATA_FILE)) {
try {
db = JSON.parse(fs.readFileSync(DATA_FILE));
console.log(“✅ Database loaded successfully.”);
} catch (e) {
console.error(“⚠️ Database corrupted, creating new one.”);
}
}

const save = () => {
try {
fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
} catch (err) {
console.error(“❌ Error saving database:”, err);
}
};

const genKey = (expiryDays = 30) => {
const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
const key = “CWUV-” + crypto.randomBytes(8).toString(“hex”).toUpperCase();
db.keys[key] = {
assignedTo: null,
expiry: Date.now() + expiryMs,
createdAt: Date.now(),
uses: 0,
maxUses: 999999 // Unlimited by default
};
save();
console.log(`🔑 Key Generated: ${key} | Expires in ${expiryDays} days`);
return key;
};

function getUserData(userId) {
if (!db.users[userId])
db.users[userId] = {
hwid: null,
execs: 0,
key: null,
expiry: null,
lastHWIDReset: 0,
username: null,
lastSeen: null
};
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
const userId = interaction.user.id;
const userData = getUserData(userId);

if (interaction.isChatInputCommand() && interaction.commandName === “setup”) {
const type = interaction.options.getString(“type”);
if (type === “admin”) {
const embed = new EmbedBuilder()
.setTitle(“🔧 Admin Panel”)
.setDescription(“Generate and manage keys”)
.setColor(“Red”);
const row1 = new ActionRowBuilder().addComponents(
createButton(“Gen Key”, “genKey”),
createButton(“View Keys”, “viewKeys”),
createButton(“Delete Key”, “deleteKey”, ButtonStyle.Danger)
);
await interaction.reply({ embeds: [embed], components: [row1] });
} else {
const embed = new EmbedBuilder()
.setTitle(“✅ Customer Panel”)
.setDescription(“Redeem keys and view stats”)
.setColor(“Green”);
const row = new ActionRowBuilder().addComponents(
createButton(“Redeem Key”, “redeemKey”),
createButton(“Stats”, “viewStats”)
);
await interaction.reply({ embeds: [embed], components: [row] });
}
}

if (interaction.isButton()) {
if (interaction.customId === “genKey”) {
const key = genKey(30); // 30 days default
await interaction.reply({
content: `✅ Key Generated: \`${key}`\nExpires in 30 days`,
ephemeral: true
});
}

```
if (interaction.customId === "viewKeys") {
  const recentKeys = Object.entries(db.keys)
    .slice(-10)
    .map(([k, v]) => {
      const assigned = v.assignedTo ? `✅ User: ${v.assignedTo}` : "❌ Unused";
      const expires = new Date(v.expiry).toLocaleDateString();
      return `\`${k}\` | ${assigned} | Expires: ${expires}`;
    })
    .join("\n") || "No keys found";
  
  await interaction.reply({ 
    content: `📋 **Recent Keys:**\n${recentKeys}`, 
    ephemeral: true 
  });
}

if (interaction.customId === "deleteKey") {
  const modal = new ModalBuilder()
    .setCustomId("deleteKeyModal")
    .setTitle("Delete Key");
  const input = new TextInputBuilder()
    .setCustomId("keyToDelete")
    .setLabel("Enter Key to Delete")
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

if (interaction.customId === "redeemKey") {
  const modal = new ModalBuilder()
    .setCustomId("redeemModal")
    .setTitle("Redeem Key");
  const input = new TextInputBuilder()
    .setCustomId("keyInput")
    .setLabel("Enter Your Key")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("CWUV-XXXXXXXXXXXXXXXX");
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

if (interaction.customId === "viewStats") {
  const keyInfo = userData.key ? `\`${userData.key}\`` : "None";
  const expiryInfo = userData.expiry ? new Date(userData.expiry).toLocaleDateString() : "N/A";
  
  const embed = new EmbedBuilder()
    .setTitle("📊 Your Stats")
    .addFields(
      { name: "Executions", value: `${userData.execs}`, inline: true },
      { name: "HWID", value: userData.hwid || "Not Set", inline: true },
      { name: "Key", value: keyInfo, inline: false },
      { name: "Expires", value: expiryInfo, inline: true }
    )
    .setColor("Blue")
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
```

}

if (interaction.isModalSubmit()) {
if (interaction.customId === “redeemModal”) {
const key = interaction.fields.getTextInputValue(“keyInput”).trim();

```
  if (!db.keys[key]) {
    return interaction.reply({ content: "❌ Invalid Key", ephemeral: true });
  }
  
  if (db.keys[key].assignedTo) {
    return interaction.reply({ content: "❌ Key Already Redeemed", ephemeral: true });
  }

  if (Date.now() > db.keys[key].expiry) {
    return interaction.reply({ content: "❌ Key Expired", ephemeral: true });
  }

  // Assign key to user
  db.keys[key].assignedTo = userId;
  userData.key = key;
  userData.expiry = db.keys[key].expiry;
  userData.username = interaction.user.username;
  save();
  
  const expiryDate = new Date(userData.expiry).toLocaleDateString();
  await interaction.reply({ 
    content: `✅ Successfully Redeemed!\n🔑 Key: \`${key}\`\n📅 Expires: ${expiryDate}`, 
    ephemeral: true 
  });
  
  console.log(`✅ Key Redeemed: ${key} by ${interaction.user.username} (${userId})`);
}

if (interaction.customId === "deleteKeyModal") {
  const key = interaction.fields.getTextInputValue("keyToDelete").trim();
  
  if (!db.keys[key]) {
    return interaction.reply({ content: "❌ Key Not Found", ephemeral: true });
  }

  delete db.keys[key];
  save();
  
  await interaction.reply({ 
    content: `✅ Key Deleted: \`${key}\``, 
    ephemeral: true 
  });
  
  console.log(`🗑️ Key Deleted: ${key}`);
}
```

}
});

/* ================= WEB API ================= */
http.createServer((req, res) => {
res.setHeader(“Content-Type”, “application/json”);
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “POST, GET, OPTIONS”);
res.setHeader(“Access-Control-Allow-Headers”, “Content-Type”);

// Handle preflight
if (req.method === “OPTIONS”) {
res.writeHead(200);
return res.end();
}

// Health check
if (req.url === “/” && req.method === “GET”) {
return res.end(JSON.stringify({
status: “online”,
service: “pelican.win Key System”,
timestamp: new Date().toISOString()
}));
}

// Key validation endpoint (for Roblox script)
if (req.url === “/validate” && req.method === “POST”) {
let body = “”;

```
req.on("data", chunk => {
  body += chunk.toString();
});

req.on("end", () => {
  try {
    const { key, userId, username } = JSON.parse(body);
    
    console.log(`🔍 Validation Request: Key=${key?.substring(0, 8)}... | User=${username} (${userId})`);

    // Check if key exists
    if (!db.keys[key]) {
      console.log(`❌ Invalid Key: ${key}`);
      return res.end(JSON.stringify({ 
        valid: false, 
        message: "Invalid key" 
      }));
    }

    const keyData = db.keys[key];
    const userData = getUserData(userId);

    // Check if key is expired
    if (Date.now() > keyData.expiry) {
      console.log(`⏰ Expired Key: ${key}`);
      return res.end(JSON.stringify({ 
        valid: false, 
        message: "Key has expired" 
      }));
    }

    // Check if key is assigned to another user
    if (keyData.assignedTo && keyData.assignedTo !== userId) {
      console.log(`🔒 Key Bound to Another User: ${key}`);
      return res.end(JSON.stringify({ 
        valid: false, 
        message: "Key is bound to another user" 
      }));
    }

    // Auto-assign key if not assigned
    if (!keyData.assignedTo) {
      keyData.assignedTo = userId;
      console.log(`🔗 Key Auto-Assigned: ${key} → ${username}`);
    }

    // Check max uses
    if (keyData.maxUses && keyData.uses >= keyData.maxUses) {
      console.log(`🚫 Max Uses Reached: ${key}`);
      return res.end(JSON.stringify({ 
        valid: false, 
        message: "Key has reached maximum uses" 
      }));
    }

    // Update usage stats
    keyData.uses = (keyData.uses || 0) + 1;
    userData.key = key;
    userData.expiry = keyData.expiry;
    userData.username = username;
    userData.execs = (userData.execs || 0) + 1;
    userData.lastSeen = Date.now();
    
    save();

    console.log(`✅ Key Validated: ${key} | User: ${username} | Uses: ${keyData.uses}`);

    // Return success
    res.end(JSON.stringify({ 
      valid: true, 
      message: "Key validated successfully!",
      expiresAt: new Date(keyData.expiry).toISOString()
    }));

  } catch (error) {
    console.error("❌ Validation Error:", error);
    res.end(JSON.stringify({ 
      valid: false, 
      message: "Server error during validation" 
    }));
  }
});
```

}

// Unknown endpoint
else {
res.writeHead(404);
res.end(JSON.stringify({ error: “Not Found” }));
}

}).listen(PORT, () => {
console.log(`🚀 API Server running on port ${PORT}`);
console.log(`📡 Endpoint: http://localhost:${PORT}/validate`);
});

/* ================= BOT STARTUP ================= */
client.once(“ready”, async () => {
console.log(`✅ Bot Online: ${client.user.tag}`);
console.log(`📊 Keys in Database: ${Object.keys(db.keys).length}`);
console.log(`👥 Users in Database: ${Object.keys(db.users).length}`);

const rest = new REST({ version: “10” }).setToken(TOKEN);

const commands = [
new SlashCommandBuilder()
.setName(“setup”)
.setDescription(“Open control panel”)
.addStringOption(option =>
option
.setName(“type”)
.setDescription(“Panel type”)
.setRequired(true)
.addChoices(
{ name: “Admin”, value: “admin” },
{ name: “Customer”, value: “customer” }
)
)
];

try {
await rest.put(
Routes.applicationGuildCommands(client.user.id, GUILD_ID),
{ body: commands }
);
console.log(“✅ Slash commands registered”);
} catch (error) {
console.error(“❌ Error registering commands:”, error);
}
});

client.login(TOKEN);

console.log(“🔧 pelican.win Key System starting…”);
