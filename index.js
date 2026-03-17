const TelegramBot = require('node-telegram-bot-api');

// ⚠️ colle ton token DIRECTEMENT ici
const TOKEN = "8636927691:AAEQhJ9qB4_1bD0YjSEjlG79IBqJ6iu4gPM";

const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Ton bot fonctionne 🚀");
});