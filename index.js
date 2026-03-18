require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");

process.env.NTBA_FIX_319 = "1";
process.env.NTBA_FIX_350 = "1";

const TOKEN       = process.env.TELEGRAM_TOKEN || "8636927691:AAEQhJ9qB4_1bD0YjSEjlG79IBqJ6iu4gPM";
const ALLOWED_IDS   = (process.env.ALLOWED_CHAT_IDS || "6158280587","8383314931").split(",").map(s => s.trim()).filter(Boolean);
const MOHS_URL    = process.env.MOHS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwaBUlIufwOOd7bIgwyfcBOyRJdocCkLNV-btjWCYGNp1DXMKTCnmQLqW1g2C9V0tV4/exec";
const DEAL_URL    = process.env.DEAL_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxz5mFr9o75t_OClT_OfdS2U69nVZyjiBSNXvJl1Pzck8h80Bk-PsS8X1lv60Kp0m1G/exec";
const CLIENT_ID   = process.env.CLIENT_ID || "MT-EPKGH";
const PORT        = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://deal-surface.onrender.com";

const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN, { polling: false });

app.post(`/bot${TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
app.get("/", (_req, res) => res.send("OK"));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

async function callDeal(payload) {
  try {
    const res = await axios.post(DEAL_URL, payload, { headers: { "Content-Type": "application/json" }, timeout: 20000 });
    return res.data;
  } catch (err) {
    return { success: false, error: err.response ? `HTTP ${err.response.status}` : err.message };
  }
}

async function abonnementActif() {
  try {
    const res = await axios.post(MOHS_URL, { action: "check_abonnement", id: CLIENT_ID }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
    const s = (res.data?.statut || res.data?.status || res.data?.etat || "").toUpperCase();
    return s === "ACTIF";
  } catch { return false; }
}

const fcfa = (n) => (!n && n !== 0) ? "—" : Number(n).toLocaleString("fr-FR") + " FCFA";
const today = () => new Date().toLocaleDateString("fr-FR");
const MSG_EXPIRE = "⛔ *Votre abonnement n'est pas actif.*\n\nContactez MOHS TECHNOLOGIE :\n📧 contact@mohstechnologie.com";

function tokenize(str) {
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g, out = [];
  let m;
  while ((m = re.exec(str)) !== null) out.push(m[1] ?? m[2] ?? m[0]);
  return out;
}

function parseVente(text) {
  const tokens = tokenize(text.replace(/^vente\s+/i, "").trim());
  const ti = tokens.findIndex(t => /^(comptant|troc)$/i.test(t));
  if (ti < 3) return null;
  return {
    nom: tokens[0], telephone: tokens[1],
    produit: tokens.slice(2, ti - 2).join(" ") || tokens[2],
    quantite: parseInt(tokens[ti - 2]), prix: parseFloat(tokens[ti - 1]),
    typeVente: tokens[ti].toLowerCase(),
    imei: tokens[ti + 1] || "", imeiTroc: tokens[ti + 2] || "",
  };
}

function parsePeriode(text) {
  const t = text.replace(/^ca\s+/i, "").trim().toLowerCase();
  const mois = { janvier:"01",fevrier:"02","février":"02",mars:"03",avril:"04",mai:"05",juin:"06",juillet:"07",aout:"08","août":"08",septembre:"09",octobre:"10",novembre:"11",decembre:"12","décembre":"12" };
  if (t === "aujourd'hui" || t === "aujourdhui") { const d = today(); return { date1: d, date2: d }; }
  if (mois[t]) { const y = new Date().getFullYear(), m = mois[t], last = new Date(y, parseInt(m), 0).getDate(); return { date1: `01/${m}/${y}`, date2: `${last}/${m}/${y}` }; }
  const p = t.split(/\s+/);
  if (p.length === 2) return { date1: p[0], date2: p[1] };
  return null;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!text) return;

  if (!(await abonnementActif())) return bot.sendMessage(chatId, MSG_EXPIRE, { parse_mode: "Markdown" });

  const low = text.toLowerCase();

  try {
    if (low === "/start" || low === "start") {
      return bot.sendMessage(chatId,
        `🏪 *Bienvenue sur le bot DEAL SURFACE !*\n\n📋 *Commandes :*\n\n*💰 Ventes*\n\`vente [nom] [tel] [produit] [qté] [prix] [comptant/troc] [imei?] [imei_troc?]\`\n\n*📦 Stock*\n\`stock\` — Voir tout le stock\n\`stock [produit]\` — Stock d'un produit\n\`restock [produit] [quantité]\` — Réapprovisionner\n\`nouveau produit [nom] [prix] [quantité]\` — Nouveau produit\n\n*📊 CA*\n\`ca aujourd'hui\` / \`ca mars\` / \`ca 01/03/2025 31/03/2025\`\n\n*📈 Stats*\n\`stats\` — Résumé complet\n\n*❓* \`aide\` — Ce menu`,
        { parse_mode: "Markdown" });
    }

    if (low === "aide" || low === "/aide") {
      return bot.sendMessage(chatId,
        `📚 *Guide DEAL SURFACE*\n\n*Vente comptant :*\n\`vente Jean 0700000001 "Redmi Pad 2" 1 150000 comptant\`\n\n*Vente troc :*\n\`vente Paul 0600000002 "HP Elitebook i5" 1 220000 troc 354ABC 789XYZ\`\n\n*Stock :*\n\`stock\` ou \`stock redmi\`\n\n*Restock :*\n\`restock "Power bank Xiaomi" 5\`\n\n*Nouveau produit :*\n\`nouveau produit "Samsung A54" 180000 8\`\n\n*CA :*\n\`ca aujourd'hui\` / \`ca mars\` / \`ca 01/03/2025 31/03/2025\`\n\n*Stats :*\n\`stats\``,
        { parse_mode: "Markdown" });
    }

    if (low.startsWith("vente ")) {
      const d = parseVente(text);
      if (!d || isNaN(d.quantite) || isNaN(d.prix)) return bot.sendMessage(chatId, `❌ *Format incorrect.*\n\nEx :\n\`vente Jean 0700000001 "Redmi Pad 2" 1 150000 comptant\``, { parse_mode: "Markdown" });
      await bot.sendMessage(chatId, "⏳ Enregistrement...");
      const montant = d.quantite * d.prix;
      const res = await callDeal({ action: "enregistrer_vente", nom: d.nom, telephone: d.telephone, produit: d.produit, quantite: d.quantite, prix: d.prix, montant, typeVente: d.typeVente, imei: d.imei, imeiTroc: d.imeiTroc, date: new Date().toISOString() });
      if (!res.success) return bot.sendMessage(chatId, `❌ *Erreur :* ${res.error || "Inconnu"}`, { parse_mode: "Markdown" });
      let r = `✅ *Vente enregistrée !*\n\n👤 *Client :* ${d.nom}\n📞 *Tél :* ${d.telephone}\n📱 *Produit :* ${d.produit}\n🔢 *Quantité :* ${d.quantite}\n💰 *Prix unitaire :* ${fcfa(d.prix)}\n💵 *Total :* ${fcfa(montant)}\n💳 *Type :* ${d.typeVente.toUpperCase()}\n`;
      if (d.imei) r += `📋 *IMEI :* \`${d.imei}\`\n`;
      if (d.imeiTroc) r += `🔁 *IMEI troc :* \`${d.imeiTroc}\`\n`;
      r += `📅 *Date :* ${today()}\n`;
      if (res.stockRestant !== undefined) { r += `\n📦 *Stock restant :* ${res.stockRestant} pièce(s)`; if (res.stockRestant < 3) r += `\n⚠️ *Stock faible !*`; }
      return bot.sendMessage(chatId, r, { parse_mode: "Markdown" });
    }

    if (low === "stock") {
      await bot.sendMessage(chatId, "⏳ Récupération du stock...");
      const res = await callDeal({ action: "voir_stock" });
      if (!res.success || !res.stock) return bot.sendMessage(chatId, `❌ Impossible de récupérer le stock.\n${res.error || ""}`, { parse_mode: "Markdown" });
      let r = `📦 *STOCK DEAL SURFACE — ${today()}*\n\n`;
      const al = [];
      for (const it of res.stock) {
        const qty = it.quantite_dispo ?? 0, em = qty === 0 ? "🔴" : qty < 3 ? "🟠" : "🟢";
        r += `${em} *${it.produit}*\n`;
        if (it.caracteristiques) r += `   📋 ${it.caracteristiques}\n`;
        r += `   💰 ${fcfa(it.prix_unitaire)}  |  📊 *${qty} pièce(s)*\n\n`;
        if (qty > 0 && qty < 3) al.push(it.produit);
      }
      if (al.length) r += `⚠️ *Stock faible :*\n` + al.map(p => `• ${p}`).join("\n");
      return bot.sendMessage(chatId, r, { parse_mode: "Markdown" });
    }

    if (low.startsWith("stock ")) {
      const produit = text.replace(/^stock\s+/i, "").trim();
      await bot.sendMessage(chatId, `⏳ Recherche de "${produit}"...`);
      const res = await callDeal({ action: "voir_stock_produit", produit });
      if (!res.success || !res.item) return bot.sendMessage(chatId, `❌ *${produit}* non trouvé.\nTapez \`stock\` pour voir tous les produits.`, { parse_mode: "Markdown" });
      const it = res.item, qty = it.quantite_dispo ?? 0, em = qty === 0 ? "🔴" : qty < 3 ? "🟠" : "🟢";
      let r = `📦 *${it.produit}*\n\n📋 *Caractéristiques :* ${it.caracteristiques || "—"}\n💰 *Prix :* ${fcfa(it.prix_unitaire)}\n${em} *Disponible :* ${qty} pièce(s)\n📅 *MAJ :* ${it.date_maj || "—"}`;
      if (qty === 0) r += "\n\n🔴 *Rupture de stock !*";
      else if (qty < 3) r += "\n\n⚠️ *Stock faible !*";
      return bot.sendMessage(chatId, r, { parse_mode: "Markdown" });
    }

    if (low.startsWith("restock ")) {
      const tokens = tokenize(text.replace(/^restock\s+/i, "").trim());
      const quantite = parseInt(tokens[tokens.length - 1]);
      const produit = tokens.slice(0, -1).join(" ");
      if (!produit || isNaN(quantite) || quantite <= 0) return bot.sendMessage(chatId, `❌ *Format :* \`restock [produit] [quantité]\`\nEx : \`restock "Redmi Pad 2" 5\``, { parse_mode: "Markdown" });
      await bot.sendMessage(chatId, "⏳ Mise à jour du stock...");
      const res = await callDeal({ action: "restock", produit, quantite, date: new Date().toISOString() });
      if (!res.success) return bot.sendMessage(chatId, `❌ Erreur : ${res.error || "Inconnu"}`, { parse_mode: "Markdown" });
      return bot.sendMessage(chatId, `✅ *Stock mis à jour !*\n\n📱 *Produit :* ${produit}\n➕ *Ajouté :* ${quantite} pièce(s)\n📦 *Nouveau stock :* ${res.nouveauStock ?? "—"} pièce(s)`, { parse_mode: "Markdown" });
    }

    if (low.startsWith("nouveau produit ")) {
      const tokens = tokenize(text.replace(/^nouveau produit\s+/i, "").trim());
      const quantite = parseInt(tokens[tokens.length - 1]);
      const prix = parseFloat(tokens[tokens.length - 2]);
      const nom = tokens.slice(0, -2).join(" ");
      if (!nom || isNaN(prix) || isNaN(quantite)) return bot.sendMessage(chatId, `❌ *Format :* \`nouveau produit [nom] [prix] [quantité]\`\nEx : \`nouveau produit "Samsung A54" 180000 8\``, { parse_mode: "Markdown" });
      await bot.sendMessage(chatId, "⏳ Ajout du produit...");
      const res = await callDeal({ action: "nouveau_produit", nom, prix, quantite, date: new Date().toISOString() });
      if (!res.success) return bot.sendMessage(chatId, `❌ Erreur : ${res.error || "Inconnu"}`, { parse_mode: "Markdown" });
      return bot.sendMessage(chatId, `✅ *Produit ajouté !*\n\n📱 *Nom :* ${nom}\n💰 *Prix :* ${fcfa(prix)}\n📦 *Stock initial :* ${quantite} pièce(s)`, { parse_mode: "Markdown" });
    }

    if (low.startsWith("ca ")) {
      const periode = parsePeriode(text);
      if (!periode) return bot.sendMessage(chatId, `❌ *Format incorrect.*\nEx : \`ca aujourd'hui\` / \`ca mars\` / \`ca 01/03/2025 31/03/2025\``, { parse_mode: "Markdown" });
      await bot.sendMessage(chatId, "⏳ Calcul du CA...");
      const res = await callDeal({ action: "chiffre_affaires", ...periode });
      if (!res.success) return bot.sendMessage(chatId, `❌ Erreur : ${res.error || "Inconnu"}`, { parse_mode: "Markdown" });
      const label = periode.date1 === periode.date2 ? `du ${periode.date1}` : `du ${periode.date1} au ${periode.date2}`;
      let r = `📊 *CA ${label}*\n\n💵 *Total :* ${fcfa(res.total)}\n🛒 *Ventes :* ${res.nbVentes ?? 0}\n💳 *Comptant :* ${fcfa(res.comptant)}\n🔁 *Troc :* ${fcfa(res.troc)}\n`;
      if (res.topProduit) r += `\n🏆 *Top produit :* ${res.topProduit} (${res.topProduitQte} ventes)`;
      return bot.sendMessage(chatId, r, { parse_mode: "Markdown" });
    }

    if (low === "stats" || low === "/stats") {
      await bot.sendMessage(chatId, "⏳ Calcul des statistiques...");
      const res = await callDeal({ action: "stats_globales" });
      if (!res.success) return bot.sendMessage(chatId, `❌ Erreur : ${res.error || "Inconnu"}`, { parse_mode: "Markdown" });
      let r = `📈 *STATISTIQUES DEAL SURFACE*\n_${today()}_\n\n━━━━━━━━━━━━━━━━━━━━\n💰 *CA*\n• Aujourd'hui : ${fcfa(res.caJour)}\n• Ce mois : ${fcfa(res.caMois)}\n• Total : ${fcfa(res.caTotal)}\n\n🛒 *VENTES*\n• Aujourd'hui : ${res.ventesJour ?? 0}\n• Ce mois : ${res.ventesMois ?? 0}\n• Total : ${res.ventesTotal ?? 0}\n\n👥 *Clients :* ${res.nbClients ?? 0}\n\n📦 *STOCK*\n• Produits dispo : ${res.produitsEnStock ?? 0}\n• Valeur : ${fcfa(res.valeurStock)}\n`;
      if (res.alertesStock?.length) r += `\n⚠️ *Stock faible :*\n` + res.alertesStock.map(p => `• ${p}`).join("\n");
      if (res.topProduit) r += `\n\n🏆 *Produit star :* ${res.topProduit}`;
      return bot.sendMessage(chatId, r, { parse_mode: "Markdown" });
    }

    return bot.sendMessage(chatId, `❓ Commande non reconnue.\nTapez \`aide\` pour voir les commandes.`, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("Error:", err.message);
    bot.sendMessage(chatId, "⚠️ Erreur inattendue. Réessayez.");
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 DEAL SURFACE Bot démarré sur le port ${PORT}`);
  if (WEBHOOK_URL) {
    try {
      await bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
      console.log(`✅ Webhook : ${WEBHOOK_URL}/bot${TOKEN}`);
    } catch (err) {
      console.error("Webhook error:", err.message);
    }
  }
});