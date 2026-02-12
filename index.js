import { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes } from "discord.js";
import fs from "fs";
import crypto from "crypto";
import http from "http";

const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 8080;
const DATA_FILE = "./data.json";

let db = { keys: {}, users: {} };

if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        console.log("Database loaded");
    } catch (e) {
        console.log("New database created");
    }
}

const save = () => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
        console.error("Save error:", err);
    }
};

const genKey = (days = 30) => {
    const key = "CWUV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
    db.keys[key] = {
        assignedTo: null,
        expiry: Date.now() + (days * 24 * 60 * 60 * 1000),
        uses: 0
    };
    save();
    return key;
};

function getUserData(userId) {
    if (!db.users[userId]) {
        db.users[userId] = { execs: 0, key: null, expiry: null };
    }
    return db.users[userId];
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
});

client.on("interactionCreate", async interaction => {
    try {
        const userId = interaction.user.id;
        const userData = getUserData(userId);

        if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
            const type = interaction.options.getString("type");

            if (type === "admin") {
                const embed = new EmbedBuilder().setTitle("Admin Panel").setColor("Red");
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel("Gen Key").setCustomId("genKey").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setLabel("View Keys").setCustomId("viewKeys").setStyle(ButtonStyle.Primary)
                );
                await interaction.reply({ embeds: [embed], components: [row] });
            } else {
                const embed = new EmbedBuilder().setTitle("Customer Panel").setColor("Green");
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel("Redeem Key").setCustomId("redeemKey").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setLabel("Stats").setCustomId("viewStats").setStyle(ButtonStyle.Primary)
                );
                await interaction.reply({ embeds: [embed], components: [row] });
            }
        }

        if (interaction.isButton()) {
            if (interaction.customId === "genKey") {
                const key = genKey(30);
                await interaction.reply({ content: "Key: `" + key + "`", ephemeral: true });
            }

            if (interaction.customId === "viewKeys") {
                const keys = Object.keys(db.keys).slice(-10).join("\n") || "No keys";
                await interaction.reply({ content: "Recent Keys:\n" + keys, ephemeral: true });
            }

            if (interaction.customId === "redeemKey") {
                const modal = new ModalBuilder().setCustomId("redeemModal").setTitle("Redeem Key");
                const input = new TextInputBuilder().setCustomId("keyInput").setLabel("Enter Key").setStyle(TextInputStyle.Short);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await interaction.showModal(modal);
            }

            if (interaction.customId === "viewStats") {
                await interaction.reply({
                    content: "Execs: " + userData.execs + "\nKey: " + (userData.key || "None"),
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

            await interaction.reply({ content: "Key Redeemed Successfully!", ephemeral: true });
        }

    } catch (err) {
        console.error("Error:", err);
    }
});

http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "OPTIONS") {
        res.writeHead(200);
        return res.end();
    }

    if (req.url === "/" && req.method === "GET") {
        return res.end(JSON.stringify({ status: "online" }));
    }

    if (req.url === "/validate" && req.method === "POST") {
        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const userId = data.userId;
                const username = data.username;

                console.log("Validating key for " + username);

                if (!db.keys[key]) {
                    return res.end(JSON.stringify({ valid: false, message: "Invalid key" }));
                }

                const keyData = db.keys[key];
                const userData = getUserData(userId);

                if (Date.now() > keyData.expiry) {
                    return res.end(JSON.stringify({ valid: false, message: "Key expired" }));
                }

                if (keyData.assignedTo && keyData.assignedTo !== userId) {
                    return res.end(JSON.stringify({ valid: false, message: "Key assigned to another user" }));
                }

                if (!keyData.assignedTo) {
                    keyData.assignedTo = userId;
                }

                keyData.uses = (keyData.uses || 0) + 1;
                userData.key = key;
                userData.expiry = keyData.expiry;
                userData.execs = (userData.execs || 0) + 1;

                save();

                console.log("Key validated for " + username);

                res.end(JSON.stringify({ valid: true, message: "Key validated successfully!" }));

            } catch (error) {
                console.error("Validation error:", error);
                res.end(JSON.stringify({ valid: false, message: "Server error" }));
            }
        });

    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not Found" }));
    }

}).listen(PORT, () => {
    console.log("API running on port " + PORT);
});

client.once("ready", async () => {
    console.log("Bot online: " + client.user.tag);

    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const commands = [
        new SlashCommandBuilder()
            .setName("setup")
            .setDescription("Open panel")
            .addStringOption(o =>
                o.setName("type").setRequired(true).addChoices(
                    { name: "Admin", value: "admin" },
                    { name: "Customer", value: "customer" }
                )
            )
    ];

    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log("Commands registered");
});

client.login(TOKEN);
