require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");

process.env.NTBA_FIX_319 = "1";
process.env.NTBA_FIX_350 = "1";

const TOKEN       = process.env.TELEGRAM_TOKEN || "8636927691:AAEQhJ9qB4_1bD0YjSEjlG79IBqJ6iu4gPM";
const ALLOWED_IDS = (process.env.ALLOWED_CHAT_IDS || "6158280587,8383314931").split(",").map(s => s.trim()).filter(Boolean);
const MOHS_URL    = process.env.MOHS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbw3FuDailGU7lF_ZaB795AOlV4w0wQFsUJU2e4llRYcbCny-zM0jeK-wp5NaHkoKFub/exec";
const DEAL_URL    = process.env.DEAL_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxVJFhmE4WBmkJe6_m-8E6uDI_CM-uEyOwbkxm-j2qmKEhbJehY_xXh4NqP7QxiEmXZ/exec";
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

// ─── PARSE VENTE MULTI-ARTICLES ───────────────────────────────────────────────
// Format : vente [nom] [tel] [comptant/troc] [produit] [qté] [prix] | [produit2] [qté2] [prix2] | ...
// IMEI optionnel après le prix : produit qté prix imei imei_troc
function parseVenteMulti(text) {
  const body = text.replace(/^vente\s+/i, "").trim();

  // Détecter le téléphone
  const tokens = tokenize(body);
  const telIdx = tokens.findIndex(t => /^[0-9+]{8,15}$/.test(t));
  if (telIdx === -1) return null;

  const nom       = tokens.slice(0, telIdx).join(" ");
  const telephone = tokens[telIdx];

  // Type de vente juste après le téléphone
  const typeVente = tokens[telIdx + 1];
  if (!typeVente || !/^(comptant|troc)$/i.test(typeVente)) return null;

  // Tout ce qui reste après typeVente = articles séparés par |
  const resteRaw = tokens.slice(telIdx + 2).join(" ");
  const articlesRaw = resteRaw.split("|").map(s => s.trim()).filter(Boolean);

  if (articlesRaw.length === 0) return null;

  const articles = [];
  for (const artRaw of articlesRaw) {
    const t = tokenize(artRaw);
    // Format : [produit] [quantité] [prix] [imei?] [imei_troc?]
    // Le produit peut être multi-mots, quantité et prix sont des nombres
    // On cherche depuis la fin : prix = dernier nombre, quantité = avant-dernier nombre
    let prixIdx = -1, qteIdx = -1;
    for (let i = t.length - 1; i >= 0; i--) {
      if (!isNaN(parseFloat(t[i])) && prixIdx === -1) { prixIdx = i; continue; }
      if (!isNaN(parseInt(t[i])) && prixIdx !== -1 && qteIdx === -1) { qteIdx = i; break; }
    }
    if (prixIdx === -1 || qteIdx === -1) return null;

    const produit  = t.slice(0, qteIdx).join(" ");
    const quantite = parseInt(t[qteIdx]);
    const prix     = parseFloat(t[prixIdx]);
    const imei     = t[prixIdx + 1] || "";
    const imeiTroc = t[prixIdx + 2] || "";

    if (!produit || isNaN(quantite) || isNaN(prix)) return null;
    articles.push({ produit, quantite, prix, imei, imeiTroc });
  }

  return { nom, telephone, typeVente: typeVente.toLowerCase(), articles };
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

  if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(chatId.toString())) {
    return bot.sendMessage(chatId, "⛔ Accès non autorisé.");
  }

  if (!(await abonnementActif())) return bot.sendMessage(chatId, MSG_EXPIRE, { parse_mode: "Markdown" });

  const low = text.toLowerCase();

  try {

    // ── /start ────────────────────────────────────────────────────────────────
    if (low === "/start" || low === "start") {
      return bot.sendMessage(chatId,
        `🏪 *Bienvenue sur le bot DEAL SURFACE !*\n\n📋 *Commandes :*\n\n` +
        `*💰 Vente 1 article :*\n\`vente [nom] [tel] [comptant/troc] [produit] [qté] [prix]\`\n\n` +
        `*💰 Vente plusieurs articles :*\n\`vente [nom] [tel] [comptant/troc] [produit] [qté] [prix] | [produit2] [qté2] [prix2]\`\n\n` +
        `*📦 Stock*\n\`stock\` / \`stock [produit]\`\n\`restock [produit] [qté] | [produit2] [qté2]\`\n\`nouveau produit [nom] [prix] [qté]\`\n\n` +
        `*📊 CA*\n\`ca aujourd'hui\` / \`ca mars\` / \`ca 01/03/2025 31/03/2025\`\n\n` +
        `*📈* \`stats\` — Résumé complet\n*❓* \`aide\` — Ce menu`,
        { parse_mode: "Markdown" });
    }

    // ── AIDE ──────────────────────────────────────────────────────────────────
    if (low === "aide" || low === "/aide") {
      return bot.sendMessage(chatId,
        `📚 *Guide DEAL SURFACE*\n\n` +
        `*Vente 1 article :*\n\`vente Jean Dupont 0700000001 comptant "Redmi Pad 2" 1 150000\`\n\n` +
        `*Vente plusieurs articles :*\n\`vente Jean Dupont 0700000001 comptant "Redmi Pad 2" 1 150000 | "Power bank Xiaomi" 2 15000\`\n\n` +
        `*Vente troc avec IMEI :*\n\`vente Paul Koné 0600000002 troc "HP Elitebook i5" 1 220000 354ABC 789XYZ\`\n\n` +
        `*Stock :*\n\`stock\` ou \`stock redmi\`\n\n` +
        `*Restock 1 produit :*\n\`restock "Power bank Xiaomi" 5\`\n\n*Restock plusieurs :*\n\`restock "Power bank Xiaomi" 5 | "Redmi Pad 2" 3 | "HP Elitebook i5" 2\`\n\n` +
        `*Nouveau produit :*\n\`nouveau produit "Samsung A54" 180000 8\`\n\n` +
        `*CA :*\n\`ca aujourd'hui\` / \`ca mars\` / \`ca 01/03/2025 31/03/2025\`\n\n` +
        `*Stats :*\n\`stats\``,
        { parse_mode: "Markdown" });
    }

    // ── VENTE ─────────────────────────────────────────────────────────────────
    if (low.startsWith("vente ")) {
      const parsed = parseVenteMulti(text);
      if (!parsed) {
        return bot.sendMessage(chatId,
          `❌ *Format incorrect.*\n\n` +
          `*1 article :*\n\`vente Jean Dupont 0700000001 comptant "Redmi Pad 2" 1 150000\`\n\n` +
          `*Plusieurs articles :*\n\`vente Jean Dupont 0700000001 comptant "Redmi Pad 2" 1 150000 | "Power bank" 2 15000\``,
          { parse_mode: "Markdown" });
      }

      await bot.sendMessage(chatId, `⏳ Enregistrement de ${parsed.articles.length} article(s)...`);

      let totalGlobal = 0;
      let replyArticles = "";
      let erreurs = [];
      let stockAlertes = [];

      for (const art of parsed.articles) {
        const montant = art.quantite * art.prix;
        totalGlobal += montant;

        const res = await callDeal({
          action: "enregistrer_vente",
          nom: parsed.nom,
          telephone: parsed.telephone,
          produit: art.produit,
          quantite: art.quantite,
          prix: art.prix,
          montant,
          typeVente: parsed.typeVente,
          imei: art.imei,
          imeiTroc: art.imeiTroc,
          date: new Date().toISOString(),
        });

        if (!res.success) {
          erreurs.push(`• ${art.produit} : ${res.error || "Erreur"}`);
        } else {
          replyArticles += `   ✅ *${art.produit}* × ${art.quantite} = ${fcfa(montant)}\n`;
          if (art.imei) replyArticles += `      📋 IMEI : \`${art.imei}\`\n`;
          if (art.imeiTroc) replyArticles += `      🔁 IMEI troc : \`${art.imeiTroc}\`\n`;
          if (res.stockRestant !== undefined && res.stockRestant < 3) {
            stockAlertes.push(`${art.produit} (${res.stockRestant} restant)`);
          }
        }
      }

      let r =
        `✅ *Vente enregistrée !*\n\n` +
        `👤 *Client :* ${parsed.nom}\n` +
        `📞 *Tél :* ${parsed.telephone}\n` +
        `💳 *Type :* ${parsed.typeVente.toUpperCase()}\n` +
        `📅 *Date :* ${today()}\n\n` +
        `🛒 *Articles :*\n${replyArticles}\n` +
        `💵 *Total général :* ${fcfa(totalGlobal)}`;

      if (erreurs.length > 0) {
        r += `\n\n❌ *Erreurs :*\n` + erreurs.join("\n");
      }
      if (stockAlertes.length > 0) {
        r += `\n\n⚠️ *Stock faible :*\n` + stockAlertes.map(s => `• ${s}`).join("\n");
      }

      return bot.sendMessage(chatId, r, { parse_mode: "Markdown" });
    }

    // ── STOCK GLOBAL ──────────────────────────────────────────────────────────
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

    // ── STOCK PRODUIT ─────────────────────────────────────────────────────────
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

    // ── RESTOCK ───────────────────────────────────────────────────────────────
    if (low.startsWith("restock ")) {
      const body = text.replace(/^restock\s+/i, "").trim();
      const articlesRaw = body.split("|").map(s => s.trim()).filter(Boolean);
      const articles = [];
      for (const artRaw of articlesRaw) {
        const tokens = tokenize(artRaw);
        const quantite = parseInt(tokens[tokens.length - 1]);
        const produit = tokens.slice(0, -1).join(" ");
        if (!produit || isNaN(quantite) || quantite <= 0) {
          return bot.sendMessage(chatId, `❌ *Format :* \`restock [produit] [qté] | [produit2] [qté2]\`\nEx : \`restock "Redmi Pad 2" 5 | "Power bank Xiaomi" 3\``, { parse_mode: "Markdown" });
        }
        articles.push({ produit, quantite });
      }
      await bot.sendMessage(chatId, `⏳ Mise à jour de ${articles.length} produit(s)...`);
      let reply = `✅ *Stock mis à jour !*\n\n`;
      const erreurs = [];
      for (const art of articles) {
        const res = await callDeal({ action: "restock", produit: art.produit, quantite: art.quantite, date: new Date().toISOString() });
        if (!res.success) {
          erreurs.push(`• ${art.produit} : ${res.error || "Erreur"}`);
        } else {
          reply += `📦 *${art.produit}*\n   ➕ Ajouté : ${art.quantite} pièce(s)  |  Nouveau stock : *${res.nouveauStock ?? "—"}*\n\n`;
        }
      }
      if (erreurs.length) reply += `❌ *Erreurs :*\n` + erreurs.join("\n");
      return bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
    }

    // ── NOUVEAU PRODUIT ───────────────────────────────────────────────────────
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

    // ── CA ────────────────────────────────────────────────────────────────────
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

    // ── STATS ─────────────────────────────────────────────────────────────────
    if (low === "stats" || low === "/stats") {
      await bot.sendMessage(chatId, "⏳ Calcul des statistiques...");
      const res = await callDeal({ action: "stats_globales" });
      if (!res.success) return bot.sendMessage(chatId, `❌ Erreur : ${res.error || "Inconnu"}`, { parse_mode: "Markdown" });
      let r = `📈 *STATISTIQUES DEAL SURFACE*\n_${today()}_\n\n━━━━━━━━━━━━━━━━━━━━\n💰 *CA*\n• Aujourd'hui : ${fcfa(res.caJour)}\n• Ce mois : ${fcfa(res.caMois)}\n• Total : ${fcfa(res.caTotal)}\n\n🛒 *VENTES*\n• Aujourd'hui : ${res.ventesJour ?? 0}\n• Ce mois : ${res.ventesMois ?? 0}\n• Total : ${res.ventesTotal ?? 0}\n\n👥 *Clients :* ${res.nbClients ?? 0}\n\n📦 *STOCK*\n• Produits dispo : ${res.produitsEnStock ?? 0}\n• Valeur : ${fcfa(res.valeurStock)}\n`;
      if (res.alertesStock?.length) r += `\n⚠️ *Stock faible :*\n` + res.alertesStock.map(p => `• ${p}`).join("\n");
      if (res.topProduit) r += `\n\n🏆 *Produit star :* ${res.topProduit}`;
      return bot.sendMessage(chatId, r, { parse_mode: "Markdown" });
    }

    // ── INCONNU ───────────────────────────────────────────────────────────────
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