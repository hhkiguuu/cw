import { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes } from “discord.js”;
import fs from “fs”;
import crypto from “crypto”;
import http from “http”;

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 8080;
const ADMIN_ROLE_ID = “1470594684383395934”;
const CUSTOMER_ROLE_ID = “1470600210597282028”;
const FOUNDER_ROLE_ID = “1470595418080546848”;
const DATA_FILE = “./data.json”;

let db = { keys: {}, users: {}, blacklist: [], suggestions: [] };

if (fs.existsSync(DATA_FILE)) {
try {
db = JSON.parse(fs.readFileSync(DATA_FILE, “utf8”));
console.log(“Database loaded”);
} catch (e) {
console.log(“Creating new database”);
}
}

const save = () => {
try {
fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
} catch (err) {
console.error(“Save error:”, err);
}
};

const genKey = (days = 30) => {
const key = “CWUV-” + crypto.randomBytes(8).toString(“hex”).toUpperCase();
db.keys[key] = {
assignedTo: null,
expiry: Date.now() + (days * 24 * 60 * 60 * 1000),
uses: 0,
createdAt: Date.now()
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
username: null,
lastHWIDReset: 0
};
}
return db.users[userId];
}

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers
],
partials: [Partials.Channel, Partials.GuildMember]
});

client.on(“interactionCreate”, async interaction => {
try {
const userId = interaction.user.id;
const userData = getUserData(userId);

```
if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
  const type = interaction.options.getString("type");
  
  if (type === "admin") {
    const embed = new EmbedBuilder()
      .setTitle("Admin Panel")
      .setDescription("Generate and manage keys")
      .setColor("Red");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Gen Key").setCustomId("genKey").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setLabel("View Keys").setCustomId("viewKeys").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setLabel("Delete Key").setCustomId("deleteKey").setStyle(ButtonStyle.Danger)
    );
    await interaction.reply({ embeds: [embed], components: [row] });
  } else {
    const embed = new EmbedBuilder()
      .setTitle("Customer Panel")
      .setDescription("Redeem keys and view your stats")
      .setColor("Green");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Redeem Key").setCustomId("redeemKey").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setLabel("Stats").setCustomId("viewStats").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setLabel("Reset HWID").setCustomId("resetHWID").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ embeds: [embed], components: [row] });
  }
}

if (interaction.isButton()) {
  if (interaction.customId === "genKey") {
    const key = genKey(30);
    const embed = new EmbedBuilder()
      .setTitle("Key Generated")
      .setDescription("Copy the key below:")
      .addFields({ name: "Key", value: "`" + key + "`" })
      .addFields({ name: "Expires", value: "30 days" })
      .setColor("Green");
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.customId === "viewKeys") {
    const keyList = Object.entries(db.keys).slice(-10).map(([k, v]) => {
      const status = v.assignedTo ? "Assigned" : "Available";
      const expires = new Date(v.expiry).toLocaleDateString();
      return "`" + k + "` - " + status + " - Expires: " + expires;
    }).join("\n") || "No keys found";
    
    const embed = new EmbedBuilder()
      .setTitle("Recent Keys")
      .setDescription(keyList)
      .setColor("Blue");
    await interaction.reply({ embeds: [embed], ephemeral: true });
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
    const keyInfo = userData.key || "None";
    const expiryDate = userData.expiry ? new Date(userData.expiry).toLocaleDateString() : "N/A";
    
    const embed = new EmbedBuilder()
      .setTitle("Your Stats")
      .addFields(
        { name: "Executions", value: String(userData.execs), inline: true },
        { name: "HWID", value: userData.hwid || "Not Set", inline: true },
        { name: "Key", value: "`" + keyInfo + "`", inline: false },
        { name: "Expires", value: expiryDate, inline: true }
      )
      .setColor("Blue");
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.customId === "resetHWID") {
    const now = Date.now();
    const cooldown = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    if (userData.lastHWIDReset && (now - userData.lastHWIDReset) < cooldown) {
      const timeLeft = Math.ceil((cooldown - (now - userData.lastHWIDReset)) / (24 * 60 * 60 * 1000));
      return interaction.reply({ 
        content: "You can reset HWID in " + timeLeft + " days", 
        ephemeral: true 
      });
    }

    userData.hwid = null;
    userData.lastHWIDReset = now;
    save();
    
    await interaction.reply({ content: "HWID Reset Successfully!", ephemeral: true });
  }
}

if (interaction.isModalSubmit()) {
  if (interaction.customId === "redeemModal") {
    const key = interaction.fields.getTextInputValue("keyInput").trim();
    
    if (!db.keys[key]) {
      return interaction.reply({ content: "Invalid Key", ephemeral: true });
    }
    
    if (db.keys[key].assignedTo) {
      return interaction.reply({ content: "Key Already Redeemed", ephemeral: true });
    }

    if (Date.now() > db.keys[key].expiry) {
      return interaction.reply({ content: "Key Expired", ephemeral: true });
    }

    db.keys[key].assignedTo = userId;
    userData.key = key;
    userData.expiry = db.keys[key].expiry;
    userData.username = interaction.user.username;
    save();
    
    const expiryDate = new Date(userData.expiry).toLocaleDateString();
    const embed = new EmbedBuilder()
      .setTitle("Key Redeemed!")
      .addFields(
        { name: "Key", value: "`" + key + "`" },
        { name: "Expires", value: expiryDate }
      )
      .setColor("Green");
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    console.log("Key redeemed: " + key + " by " + interaction.user.username);
  }

  if (interaction.customId === "deleteKeyModal") {
    const key = interaction.fields.getTextInputValue("keyToDelete").trim();
    
    if (!db.keys[key]) {
      return interaction.reply({ content: "Key Not Found", ephemeral: true });
    }

    delete db.keys[key];
    save();
    
    await interaction.reply({ content: "Key Deleted: `" + key + "`", ephemeral: true });
    console.log("Key deleted: " + key);
  }
}
```

} catch (err) {
console.error(“Interaction error:”, err);
}
});

http.createServer((req, res) => {
res.setHeader(“Content-Type”, “application/json”);
res.setHeader(“Access-Control-Allow-Origin”, “*”);

if (req.method === “OPTIONS”) {
res.writeHead(200);
return res.end();
}

if (req.url === “/” && req.method === “GET”) {
return res.end(JSON.stringify({
status: “online”,
service: “pelican.win Key System”,
timestamp: new Date().toISOString()
}));
}

if (req.url === “/validate” && req.method === “POST”) {
let body = “”;

```
req.on("data", chunk => {
  body += chunk.toString();
});

req.on("end", () => {
  try {
    const data = JSON.parse(body);
    const key = data.key;
    const userId = data.userId;
    const username = data.username;
    
    console.log("Validating: " + key + " for " + username);

    if (!db.keys[key]) {
      console.log("Invalid key");
      return res.end(JSON.stringify({ valid: false, message: "Invalid key" }));
    }

    const keyData = db.keys[key];
    const userData = getUserData(userId);

    if (Date.now() > keyData.expiry) {
      console.log("Key expired");
      return res.end(JSON.stringify({ valid: false, message: "Key expired" }));
    }

    if (keyData.assignedTo && keyData.assignedTo !== userId) {
      console.log("Key bound to another user");
      return res.end(JSON.stringify({ valid: false, message: "Key bound to another user" }));
    }

    if (!keyData.assignedTo) {
      keyData.assignedTo = userId;
      console.log("Key auto-assigned to " + username);
    }

    keyData.uses = (keyData.uses || 0) + 1;
    userData.key = key;
    userData.expiry = keyData.expiry;
    userData.username = username;
    userData.execs = (userData.execs || 0) + 1;
    
    save();

    console.log("Key validated for " + username);

    res.end(JSON.stringify({ 
      valid: true, 
      message: "Key validated successfully!",
      expiresAt: new Date(keyData.expiry).toISOString()
    }));

  } catch (error) {
    console.error("Validation error:", error);
    res.end(JSON.stringify({ valid: false, message: "Server error" }));
  }
});
```

} else {
res.writeHead(404);
res.end(JSON.stringify({ error: “Not Found” }));
}

}).listen(PORT, () => {
console.log(“API Server running on port “ + PORT);
});

client.once(“ready”, async () => {
console.log(“Bot Online: “ + client.user.tag);
console.log(“Keys in database: “ + Object.keys(db.keys).length);
console.log(“Users in database: “ + Object.keys(db.users).length);

const rest = new REST({ version: “10” }).setToken(TOKEN);
const commands = [
new SlashCommandBuilder()
.setName(“setup”)
.setDescription(“Open control panel”)
.addStringOption(o =>
o.setName(“type”)
.setDescription(“Panel type”)
.setRequired(true)
.addChoices(
{ name: “Admin”, value: “admin” },
{ name: “Customer”, value: “customer” }
)
)
];

await rest.put(
Routes.applicationGuildCommands(client.user.id, GUILD_ID),
{ body: commands }
);
console.log(“Commands registered”);
});

client.login(TOKEN);

console.log(“pelican.win Key System starting…”);
