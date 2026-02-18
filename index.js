import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField
} from "discord.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const COOLDOWN_HOURS = 7;

// ===== MONGODB =====
await mongoose.connect(process.env.MONGO_URI);

// ===== SCHEMAS =====
const Config = mongoose.model("Config", new mongoose.Schema({
  stock: Number
}));

const Cooldown = mongoose.model("Cooldown", new mongoose.Schema({
  userId: String,
  expires: Number
}));

const UsedName = mongoose.model("UsedName", new mongoose.Schema({
  name: String
}));

// ===== INIT CONFIG =====
async function initConfig() {
  let config = await Config.findOne();
  if (!config) {
    config = await Config.create({ stock: 673 }); // 🔧 starting stock
  }
}
await initConfig();

// ===== GENERATOR =====
function generateTuff4L() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";

  return (
    letters[Math.floor(Math.random() * letters.length)] +
    numbers[Math.floor(Math.random() * numbers.length)] +
    letters[Math.floor(Math.random() * letters.length)] +
    letters[Math.floor(Math.random() * letters.length)]
  );
}

function formatTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== INTERACTIONS =====
client.on("interactionCreate", async interaction => {

  // ===== SLASH COMMANDS =====
  if (interaction.isChatInputCommand()) {

    // SEND PANEL
    if (interaction.commandName === "send_4l") {
      const config = await Config.findOne();

      const embed = new EmbedBuilder()
        .setTitle("💰 premium feature")
        .setDescription(
          `click the button below to generate a valid 4L username\n\n` +
          `**4L stock:** ${config.stock}`
        )
        .setColor(0x2b2d31);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("generate_4l")
          .setLabel("Generate")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(config.stock <= 0)
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    // ADD STOCK (ADMIN)
    if (interaction.commandName === "add_stock") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
      }

      const amount = interaction.options.getInteger("amount");
      const config = await Config.findOne();
      config.stock += amount;
      await config.save();

      await interaction.reply(`✅ Added ${amount} stock.\n📦 New stock: ${config.stock}`);
    }
  }

  // ===== BUTTON =====
  if (interaction.isButton() && interaction.customId === "generate_4l") {
    const userId = interaction.user.id;
    const now = Date.now();

    const config = await Config.findOne();
    if (config.stock <= 0) {
      return interaction.reply({ content: "❌ Out of stock.", ephemeral: true });
    }

    const cd = await Cooldown.findOne({ userId });
    if (cd && now < cd.expires) {
      return interaction.reply({
        content: `⏳ You can generate again in **${formatTime(cd.expires - now)}**`,
        ephemeral: true
      });
    }

    // GENERATE UNIQUE
    let username;
    while (true) {
      username = generateTuff4L();
      const exists = await UsedName.findOne({ name: username });
      if (!exists) break;
    }

    await UsedName.create({ name: username });
    config.stock -= 1;
    await config.save();

    await Cooldown.findOneAndUpdate(
      { userId },
      { expires: now + COOLDOWN_HOURS * 3600000 },
      { upsert: true }
    );

    try {
      await interaction.user.send(`🔥 Your 4-letter username:\n\n**${username}**`);
    } catch {
      return interaction.reply({ content: "❌ Enable DMs to receive it.", ephemeral: true });
    }

    await interaction.reply({
      content: "✅ Sent to your DMs.\n⏳ Next generate in 7 hours.",
      ephemeral: true
    });
  }
});

// ===== REGISTER COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("send_4l")
    .setDescription("Send the 4L generator panel"),

  new SlashCommandBuilder()
    .setName("add_stock")
    .setDescription("Add stock (Admin only)")
    .addIntegerOption(option =>
      option.setName("amount")
        .setDescription("Amount to add")
        .setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

await rest.put(
  Routes.applicationCommands(process.env.CLIENT_ID),
  { body: commands }
);

client.login(process.env.TOKEN);