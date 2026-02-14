import http from "http";
import fs from "fs";
import crypto from "crypto";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";

const PORT = process.env.PORT || 8080;
const DB_FILE = "./keys.json"; // Persist keys

// Discord setup
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_CHANNEL_ID = "1470650486666301443";

// Load or initialize database
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  if (!db.keys) db.keys = {};
  if (!db.users) db.users = {};
  if (!db.blacklistedKeys) db.blacklistedKeys = [];
  if (!db.blacklistedHWIDs) db.blacklistedHWIDs = [];
} catch {
  db = { keys: {}, users: {}, blacklistedKeys: [], blacklistedHWIDs: [] };
}

// Save helper
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.once("ready", () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});
client.login(DISCORD_TOKEN);

// Generate a new key
const generateKey = (expiryMs = 24*60*60*1000) => {
  const key = "PELICAN-" + crypto.randomBytes(8).toString("hex").toUpperCase();
  db.keys[key] = { assigned: false, expiry: null, defaultExpiry: expiryMs };
  saveDB();
  return key;
};

// Pick a pre-existing key from keys.json
const pickPreKey = () => {
  const unusedKeys = Object.entries(db.keys).filter(([k,v]) => !v.assigned && !db.blacklistedKeys.includes(k));
  if (!unusedKeys.length) return null;
  const [key] = unusedKeys[Math.floor(Math.random() * unusedKeys.length)];
  db.keys[key].assigned = true;
  db.keys[key].expiry = Date.now() + db.keys[key].defaultExpiry;
  saveDB();
  return key;
};

// Validate key
const validateKey = (key) => {
  if (db.blacklistedKeys.includes(key)) return "invalid";
  const data = db.keys[key];
  if (!data) return "invalid";
  if (data.expiry && Date.now() > data.expiry) return "expired";
  if (data.assigned) return "used";
  data.assigned = true;
  data.expiry = Date.now() + data.defaultExpiry;
  saveDB();
  return "valid";
};

// HTTP server
const server = http.createServer((req,res)=>{
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const key = urlObj.searchParams.get("key");
  const action = urlObj.searchParams.get("action");
  const expiry = parseInt(urlObj.searchParams.get("expiry")||"86400000");

  res.setHeader("Content-Type","text/plain");

  if(action==="generate"){
    const newKey = generateKey(expiry);
    return res.end(newKey);
  }

  if(action==="genprekey"){
    const preKey = pickPreKey();
    return res.end(preKey||"No unused pre-generated keys left.");
  }

  if(!key) return res.end("Provide a key with ?key=YOUR_KEY");
  const result = validateKey(key);
  res.end(result);
});

server.listen(PORT,()=>console.log(`Key server running on port ${PORT}`));

// Discord commands
client.on("messageCreate", async msg=>{
  if(!msg.guild) return;
  const args = msg.content.split(" ");
  const cmd = args.shift().toLowerCase();

  const adminRoles = ["1470621891600584744","1470595418080546848"];
  const customerRoles = ["1470600210597282028"];
  const memberRoles = msg.member.roles.cache.map(r=>r.id);
  const isAdmin = memberRoles.some(r=>adminRoles.includes(r));
  const isCustomer = memberRoles.some(r=>customerRoles.includes(r));

  // Admin commands
  if(isAdmin){
    // /gen <expiryMs>
    if(cmd==="!gen"){
      const expiry = parseInt(args[0])||86400000;
      const newKey = generateKey(expiry);
      msg.reply(`Generated new key: \`${newKey}\` (Expires in ${expiry/1000/60} minutes)`);
    }

    // /genprekey
    if(cmd==="!genprekey"){
      const preKey = pickPreKey();
      msg.reply(preKey ? `Pre-generated key: \`${preKey}\`` : "No unused pre-generated keys left.");
    }

    // /keysleft
    if(cmd==="!keysleft"){
      const remaining = Object.values(db.keys).filter(k=>!k.assigned && !db.blacklistedKeys.includes(k)).length;
      msg.reply(`Remaining unassigned keys: **${remaining}**`);
    }

    // /blacklistkey <key>
    if(cmd==="!blacklistkey"){
      const k = args[0];
      if(!db.keys[k]) return msg.reply("Key not found.");
      if(!db.blacklistedKeys.includes(k)) db.blacklistedKeys.push(k);
      saveDB();
      msg.reply(`Key \`${k}\` is now blacklisted.`);
    }

    // /forcehwid <userId>
    if(cmd==="!forcehwid"){
      const userId = args[0];
      if(!userId) return msg.reply("Provide a user ID.");
      db.users[userId]={hwidForced:true};
      saveDB();
      msg.reply(`Forced HWID reset for <@${userId}>`);
    }
  }

  // Customer commands
  if(isCustomer){
    // /resethwid
    if(cmd==="!resethwid"){
      const userId = msg.author.id;
      const cooldown = 24*60*60*1000;
      const now = Date.now();
      if(db.users[userId]?.lastHWIDReset && now - db.users[userId].lastHWIDReset < cooldown){
        const left = cooldown - (now - db.users[userId].lastHWIDReset);
        return msg.reply(`HWID reset on cooldown. Time left: ${Math.floor(left/1000/60)} minutes`);
      }
      db.users[userId]={...db.users[userId], lastHWIDReset:now};
      saveDB();
      msg.reply("HWID reset successful!");
    }
  }

  // Customer panel embed (visible to everyone)
  if(cmd==="!panel"){
    const embed = new EmbedBuilder()
      .setTitle("Customer Panel")
      .setDescription("Customers can claim keys and reset HWIDs here.")
      .addFields([
        {name:"Claim Key", value:"Use `/genprekey`"},
        {name:"Reset HWID", value:"Use `/resethwid` (24h cooldown)"},
        {name:"Get Script", value:"Use your loader with your key to get the script"}
      ])
      .setColor(0x1ABC9C)
      .setFooter({text:"Customer panel - everyone can see"});
    msg.channel.send({embeds:[embed]});
  }
});