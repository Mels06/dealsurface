require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_TOKEN || "8636927691:AAEQhJ9qB4_1bD0YjSEjlG79IBqJ6iu4gPM";
const MOHS_SCRIPT_URL = process.env.MOHS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbxwWGP7iqysY2dHFu-auOC0liAY2WCgndsviSFtZebs_BU0jUDf_sRr-qwE9vbf6gfb/exec";
const DEAL_SCRIPT_URL = process.env.DEAL_SCRIPT_URL || "https://script.google.com/a/macros/mohstechnologie.com/s/AKfycbzKwGXsCSql9Jo3Qj99wjRcfCbbXWR9KPyiLPp78bR4V6a93H6EgbymqE0m2ReU39LM/exec";
const CLIENT_ID = process.env.CLIENT_ID || "MT-EPKGH"; // ID abonnement MOHS du client
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://deal-surface.onrender.com";

// ─── EXPRESS + BOT ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN, { polling: false });

// Webhook setup
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("✅ DEAL SURFACE Bot actif"));
app.get("/health", (req, res) => res.json({ status: "ok", bot: "DEAL SURFACE", time: new Date() }));

// ─── HELPERS ───────────────────────────────────────────────────────────────────
async function callDealScript(payload) {
  try {
    const res = await axios.post(DEAL_SCRIPT_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    console.error("Erreur Apps Script DEAL:", err.message);
    return { success: false, error: err.message };
  }
}

async function verifierAbonnement() {
  try {
    const res = await axios.post(
      MOHS_SCRIPT_URL,
      { action: "check_abonnement", id: CLIENT_ID },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );
    const data = res.data;
    // Le statut peut être dans data.statut, data.status ou data.etat
    const statut = (data.statut || data.status || data.etat || "").toUpperCase();
    return statut === "ACTIF";
  } catch (err) {
    console.error("Erreur vérification abonnement:", err.message);
    // En cas d'erreur réseau on bloque par sécurité
    return false;
  }
}

const MSG_ABONNEMENT_EXPIRE =
  "⛔ *Votre abonnement n'est pas actif.*\n\nContactez MOHS TECHNOLOGIE :\n📧 contact@mohstechnologie.com";

function formatMontant(n) {
  if (n === undefined || n === null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fr-FR") + " FCFA";
}

function dateJour() {
  return new Date().toLocaleDateString("fr-FR");
}

// ─── PARSEURS ──────────────────────────────────────────────────────────────────
// vente [nom_client] [telephone] [produit] [quantite] [prix] [type_vente] [imei?] [imei_troc?]
function parseVente(text) {
  // On retire le mot "vente" au début
  const args = text.replace(/^vente\s+/i, "").trim();

  // Extraction avec regex : on cherche les champs fixes puis les IMEI optionnels
  // Les tokens sont séparés par des espaces SAUF si entre guillemets
  const tokens = tokenize(args);

  if (tokens.length < 6) return null;

  // Le produit peut être multi-mots : on tente de détecter le type_vente (comptant/troc)
  const typeVenteIdx = tokens.findIndex(
    (t) => t.toLowerCase() === "comptant" || t.toLowerCase() === "troc"
  );
  if (typeVenteIdx < 3) return null; // pas assez de champs avant

  const nom = tokens[0];
  const telephone = tokens[1];
  const produit = tokens.slice(2, typeVenteIdx - 2).join(" ") || tokens[2];
  const quantite = tokens[typeVenteIdx - 2];
  const prix = tokens[typeVenteIdx - 1];
  const typeVente = tokens[typeVenteIdx];
  const imei = tokens[typeVenteIdx + 1] || "";
  const imeiTroc = tokens[typeVenteIdx + 2] || "";

  return { nom, telephone, produit, quantite: parseInt(quantite), prix: parseFloat(prix), typeVente, imei, imeiTroc };
}

function tokenize(str) {
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const tokens = [];
  let match;
  while ((match = regex.exec(str)) !== null) {
    tokens.push(match[1] || match[2] || match[0]);
  }
  return tokens;
}

function parsePeriode(texte) {
  // ca aujourd'hui | ca mars | ca 01/03/2025 31/03/2025
  const t = texte.replace(/^ca\s+/i, "").trim().toLowerCase();

  const mois = {
    janvier: "01", fevrier: "02", "février": "02", mars: "03",
    avril: "04", mai: "05", juin: "06", juillet: "07", aout: "08",
    "août": "08", septembre: "09", octobre: "10", novembre: "11", decembre: "12", "décembre": "12"
  };

  if (t === "aujourd'hui" || t === "aujourdhui") {
    const d = dateJour();
    return { date1: d, date2: d };
  }

  if (mois[t]) {
    const year = new Date().getFullYear();
    const m = mois[t];
    const lastDay = new Date(year, parseInt(m), 0).getDate();
    return { date1: `01/${m}/${year}`, date2: `${lastDay}/${m}/${year}` };
  }

  const parts = t.split(/\s+/);
  if (parts.length === 2) {
    return { date1: parts[0], date2: parts[1] };
  }

  return null;
}

// ─── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (!text) return;

  // 1. Vérification abonnement
  const actif = await verifierAbonnement();
  if (!actif) {
    return bot.sendMessage(chatId, MSG_ABONNEMENT_EXPIRE, { parse_mode: "Markdown" });
  }

  // 2. Routing des commandes
  const lower = text.toLowerCase();

  try {
    // ── /start ──────────────────────────────────────────────────────────────
    if (lower === "/start" || lower === "start") {
      return bot.sendMessage(
        chatId,
        `🏪 *Bienvenue sur le bot DEAL SURFACE !*\n\n` +
        `Je gère vos ventes, votre stock et vos statistiques.\n\n` +
        `📋 *Commandes disponibles :*\n\n` +
        `*💰 Ventes*\n` +
        `\`vente [nom] [tel] [produit] [qté] [prix] [comptant/troc] [imei?] [imei_troc?]\`\n\n` +
        `*📦 Stock*\n` +
        `\`stock\` — Voir tout le stock\n` +
        `\`stock [produit]\` — Stock d'un produit\n` +
        `\`restock [produit] [quantité]\` — Ajouter du stock\n` +
        `\`nouveau produit [nom] [prix] [quantité]\` — Nouveau produit\n\n` +
        `*📊 Chiffre d'affaires*\n` +
        `\`ca aujourd'hui\` — CA du jour\n` +
        `\`ca mars\` — CA du mois\n` +
        `\`ca 01/03/2025 31/03/2025\` — CA par période\n\n` +
        `*📈 Stats*\n` +
        `\`stats\` — Résumé complet\n\n` +
        `*❓ Aide*\n` +
        `\`aide\` — Afficher ce menu`,
        { parse_mode: "Markdown" }
      );
    }

    // ── AIDE ────────────────────────────────────────────────────────────────
    if (lower === "aide" || lower === "/aide" || lower === "help") {
      return bot.sendMessage(
        chatId,
        `📚 *Guide d'utilisation DEAL SURFACE*\n\n` +
        `*Enregistrer une vente :*\n` +
        `\`vente Jean 0700000000 "Redmi Pad 2" 1 150000 comptant\`\n` +
        `\`vente Paul 0600000000 "HP Elitebook i5" 1 250000 troc 354ABC 789XYZ\`\n\n` +
        `*Consulter le stock :*\n` +
        `\`stock\` ou \`stock redmi\`\n\n` +
        `*Réapprovisionner :*\n` +
        `\`restock "Power bank Xiaomi" 5\`\n\n` +
        `*Ajouter un produit :*\n` +
        `\`nouveau produit "Samsung A54" 180000 8\`\n\n` +
        `*Chiffre d'affaires :*\n` +
        `\`ca aujourd'hui\` / \`ca mars\` / \`ca 01/03/2025 31/03/2025\`\n\n` +
        `*Statistiques globales :*\n` +
        `\`stats\``,
        { parse_mode: "Markdown" }
      );
    }

    // ── VENTE ───────────────────────────────────────────────────────────────
    if (lower.startsWith("vente ")) {
      const data = parseVente(text);
      if (!data) {
        return bot.sendMessage(
          chatId,
          `❌ *Format incorrect.*\n\nUtilisez :\n` +
          `\`vente [nom] [téléphone] [produit] [quantité] [prix] [comptant/troc] [imei?] [imei_troc?]\`\n\n` +
          `*Exemple :*\n\`vente Jean 0700000000 "Redmi Pad 2" 1 150000 comptant\``,
          { parse_mode: "Markdown" }
        );
      }

      await bot.sendMessage(chatId, "⏳ Enregistrement en cours...");

      const montant = data.quantite * data.prix;
      const res = await callDealScript({
        action: "enregistrer_vente",
        nom: data.nom,
        telephone: data.telephone,
        produit: data.produit,
        quantite: data.quantite,
        prix: data.prix,
        montant,
        typeVente: data.typeVente,
        imei: data.imei,
        imeiTroc: data.imeiTroc,
        date: new Date().toISOString(),
      });

      if (!res.success) {
        return bot.sendMessage(
          chatId,
          `❌ *Erreur lors de l'enregistrement :*\n${res.error || res.message || "Erreur inconnue"}`,
          { parse_mode: "Markdown" }
        );
      }

      let msg =
        `✅ *Vente enregistrée avec succès !*\n\n` +
        `👤 *Client :* ${data.nom}\n` +
        `📞 *Tél :* ${data.telephone}\n` +
        `📱 *Produit :* ${data.produit}\n` +
        `🔢 *Quantité :* ${data.quantite}\n` +
        `💰 *Prix unitaire :* ${formatMontant(data.prix)}\n` +
        `💵 *Montant total :* ${formatMontant(montant)}\n` +
        `💳 *Type :* ${data.typeVente.toUpperCase()}\n`;

      if (data.imei) msg += `📋 *IMEI :* \`${data.imei}\`\n`;
      if (data.imeiTroc) msg += `🔁 *IMEI troc :* \`${data.imeiTroc}\`\n`;
      msg += `📅 *Date :* ${dateJour()}\n`;

      if (res.stockRestant !== undefined && res.stockRestant < 3) {
        msg += `\n⚠️ *ALERTE STOCK :* Il ne reste que *${res.stockRestant} pièce(s)* de ${data.produit} !`;
      }

      if (res.stockRestant !== undefined) {
        msg += `\n📦 *Stock restant :* ${res.stockRestant} pièce(s)`;
      }

      return bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    // ── STOCK ───────────────────────────────────────────────────────────────
    if (lower === "stock") {
      await bot.sendMessage(chatId, "⏳ Récupération du stock...");

      const res = await callDealScript({ action: "voir_stock" });

      if (!res.success || !res.stock) {
        return bot.sendMessage(chatId, `❌ Impossible de récupérer le stock.\n${res.error || ""}`, { parse_mode: "Markdown" });
      }

      let msg = `📦 *STOCK DEAL SURFACE — ${dateJour()}*\n\n`;
      let alertes = [];

      for (const item of res.stock) {
        const qty = item.quantite_dispo ?? item.QUANTITE_DISPO ?? 0;
        const emoji = qty === 0 ? "🔴" : qty < 3 ? "🟠" : "🟢";
        msg += `${emoji} *${item.produit || item.PRODUIT}*\n`;
        if (item.caracteristiques || item.CARACTERISTIQUES) {
          msg += `   📋 ${item.caracteristiques || item.CARACTERISTIQUES}\n`;
        }
        msg += `   💰 ${formatMontant(item.prix_unitaire || item.PRIX_UNITAIRE)}\n`;
        msg += `   📊 Disponible : *${qty} pièce(s)*\n\n`;

        if (qty > 0 && qty < 3) alertes.push(item.produit || item.PRODUIT);
      }

      if (alertes.length > 0) {
        msg += `⚠️ *ALERTES STOCK FAIBLE :*\n`;
        alertes.forEach((p) => (msg += `• ${p}\n`));
      }

      return bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    if (lower.startsWith("stock ")) {
      const produit = text.replace(/^stock\s+/i, "").trim();
      await bot.sendMessage(chatId, `⏳ Recherche du stock pour "${produit}"...`);

      const res = await callDealScript({ action: "voir_stock_produit", produit });

      if (!res.success || !res.item) {
        return bot.sendMessage(
          chatId,
          `❌ Produit *${produit}* non trouvé dans le stock.\n\nTapez \`stock\` pour voir tous les produits.`,
          { parse_mode: "Markdown" }
        );
      }

      const item = res.item;
      const qty = item.quantite_dispo ?? item.QUANTITE_DISPO ?? 0;
      const emoji = qty === 0 ? "🔴" : qty < 3 ? "🟠" : "🟢";

      let msg =
        `📦 *Stock — ${item.produit || item.PRODUIT}*\n\n` +
        `📋 *Caractéristiques :* ${item.caracteristiques || item.CARACTERISTIQUES || "—"}\n` +
        `💰 *Prix unitaire :* ${formatMontant(item.prix_unitaire || item.PRIX_UNITAIRE)}\n` +
        `${emoji} *Disponible :* ${qty} pièce(s)\n` +
        `📅 *Dernière MAJ :* ${item.date_maj || item.DATE_MAJ || "—"}`;

      if (qty < 3 && qty > 0) {
        msg += `\n\n⚠️ *Stock faible ! Pensez à réapprovisionner.*`;
      } else if (qty === 0) {
        msg += `\n\n🔴 *Rupture de stock !*`;
      }

      return bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    // ── RESTOCK ─────────────────────────────────────────────────────────────
    if (lower.startsWith("restock ")) {
      const args = text.replace(/^restock\s+/i, "").trim();
      const tokens = tokenize(args);
      if (tokens.length < 2) {
        return bot.sendMessage(
          chatId,
          `❌ *Format incorrect.*\nUtilisez : \`restock [produit] [quantité]\`\n\nEx : \`restock "Redmi Pad 2" 5\``,
          { parse_mode: "Markdown" }
        );
      }
      const quantite = parseInt(tokens[tokens.length - 1]);
      const produit = tokens.slice(0, tokens.length - 1).join(" ");

      if (isNaN(quantite) || quantite <= 0) {
        return bot.sendMessage(chatId, `❌ La quantité doit être un nombre positif.`, { parse_mode: "Markdown" });
      }

      await bot.sendMessage(chatId, `⏳ Mise à jour du stock...`);

      const res = await callDealScript({ action: "restock", produit, quantite, date: new Date().toISOString() });

      if (!res.success) {
        return bot.sendMessage(chatId, `❌ Erreur : ${res.error || res.message || "Inconnu"}`, { parse_mode: "Markdown" });
      }

      return bot.sendMessage(
        chatId,
        `✅ *Stock mis à jour !*\n\n` +
        `📱 *Produit :* ${produit}\n` +
        `➕ *Ajouté :* ${quantite} pièce(s)\n` +
        `📦 *Nouveau stock :* ${res.nouveauStock ?? "—"} pièce(s)\n` +
        `📅 *Date :* ${dateJour()}`,
        { parse_mode: "Markdown" }
      );
    }

    // ── NOUVEAU PRODUIT ─────────────────────────────────────────────────────
    if (lower.startsWith("nouveau produit ")) {
      const args = text.replace(/^nouveau produit\s+/i, "").trim();
      const tokens = tokenize(args);

      if (tokens.length < 3) {
        return bot.sendMessage(
          chatId,
          `❌ *Format incorrect.*\nUtilisez : \`nouveau produit [nom] [prix] [quantité]\`\n\nEx : \`nouveau produit "Samsung A54" 180000 8\``,
          { parse_mode: "Markdown" }
        );
      }

      const quantite = parseInt(tokens[tokens.length - 1]);
      const prix = parseFloat(tokens[tokens.length - 2]);
      const nom = tokens.slice(0, tokens.length - 2).join(" ");

      if (isNaN(prix) || isNaN(quantite)) {
        return bot.sendMessage(chatId, `❌ Le prix et la quantité doivent être des nombres valides.`, { parse_mode: "Markdown" });
      }

      await bot.sendMessage(chatId, `⏳ Ajout du produit en cours...`);

      const res = await callDealScript({
        action: "nouveau_produit",
        nom,
        prix,
        quantite,
        date: new Date().toISOString(),
      });

      if (!res.success) {
        return bot.sendMessage(chatId, `❌ Erreur : ${res.error || res.message || "Inconnu"}`, { parse_mode: "Markdown" });
      }

      return bot.sendMessage(
        chatId,
        `✅ *Nouveau produit ajouté !*\n\n` +
        `📱 *Nom :* ${nom}\n` +
        `💰 *Prix :* ${formatMontant(prix)}\n` +
        `📦 *Stock initial :* ${quantite} pièce(s)\n` +
        `📅 *Date :* ${dateJour()}`,
        { parse_mode: "Markdown" }
      );
    }

    // ── CHIFFRE D'AFFAIRES ──────────────────────────────────────────────────
    if (lower.startsWith("ca ")) {
      const periode = parsePeriode(text);
      if (!periode) {
        return bot.sendMessage(
          chatId,
          `❌ *Format incorrect.*\n\nExemples :\n` +
          `• \`ca aujourd'hui\`\n` +
          `• \`ca mars\`\n` +
          `• \`ca 01/03/2025 31/03/2025\``,
          { parse_mode: "Markdown" }
        );
      }

      await bot.sendMessage(chatId, `⏳ Calcul du chiffre d'affaires...`);

      const res = await callDealScript({ action: "chiffre_affaires", date1: periode.date1, date2: periode.date2 });

      if (!res.success) {
        return bot.sendMessage(chatId, `❌ Erreur : ${res.error || res.message || "Inconnu"}`, { parse_mode: "Markdown" });
      }

      let label = "";
      if (periode.date1 === periode.date2) {
        label = `du ${periode.date1}`;
      } else {
        label = `du ${periode.date1} au ${periode.date2}`;
      }

      let msg =
        `📊 *Chiffre d'Affaires ${label}*\n\n` +
        `💵 *CA Total :* ${formatMontant(res.total)}\n` +
        `🛒 *Nb ventes :* ${res.nbVentes ?? "—"}\n` +
        `💳 *Comptant :* ${formatMontant(res.comptant)}\n` +
        `🔁 *Troc :* ${formatMontant(res.troc)}\n`;

      if (res.topProduit) {
        msg += `\n🏆 *Produit le + vendu :* ${res.topProduit} (${res.topProduitQte ?? "—"} ventes)`;
      }

      return bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    // ── STATS ───────────────────────────────────────────────────────────────
    if (lower === "stats" || lower === "/stats") {
      await bot.sendMessage(chatId, `⏳ Calcul des statistiques...`);

      const res = await callDealScript({ action: "stats_globales" });

      if (!res.success) {
        return bot.sendMessage(chatId, `❌ Erreur : ${res.error || res.message || "Inconnu"}`, { parse_mode: "Markdown" });
      }

      let msg =
        `📈 *STATISTIQUES DEAL SURFACE*\n` +
        `📅 _Mise à jour : ${dateJour()}_\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 *CHIFFRE D'AFFAIRES*\n` +
        `• Aujourd'hui : ${formatMontant(res.caJour)}\n` +
        `• Ce mois : ${formatMontant(res.caMois)}\n` +
        `• Total : ${formatMontant(res.caTotal)}\n\n` +
        `🛒 *VENTES*\n` +
        `• Aujourd'hui : ${res.ventesJour ?? 0} vente(s)\n` +
        `• Ce mois : ${res.ventesMois ?? 0} vente(s)\n` +
        `• Total : ${res.ventesTotal ?? 0} vente(s)\n\n` +
        `👥 *CLIENTS*\n` +
        `• Total clients : ${res.nbClients ?? 0}\n\n` +
        `📦 *STOCK*\n` +
        `• Produits en stock : ${res.produitsEnStock ?? 0}\n` +
        `• Valeur stock : ${formatMontant(res.valeurStock)}\n`;

      if (res.alertesStock && res.alertesStock.length > 0) {
        msg += `\n⚠️ *Alertes stock faible :*\n`;
        res.alertesStock.forEach((p) => (msg += `  • ${p}\n`));
      }

      if (res.topProduit) {
        msg += `\n🏆 *Produit star :* ${res.topProduit}`;
      }

      return bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }

    // ── COMMANDE INCONNUE ───────────────────────────────────────────────────
    return bot.sendMessage(
      chatId,
      `❓ Commande non reconnue.\n\nTapez \`aide\` pour voir la liste des commandes disponibles.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Erreur handler:", err);
    bot.sendMessage(chatId, `⚠️ Une erreur inattendue est survenue. Veuillez réessayer.`);
  }
});

// ─── DÉMARRAGE ─────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`🚀 DEAL SURFACE Bot démarré sur le port ${PORT}`);

  if (WEBHOOK_URL) {
    try {
      await bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
      console.log(`✅ Webhook configuré : ${WEBHOOK_URL}/bot${TOKEN}`);
    } catch (err) {
      console.error("❌ Erreur webhook:", err.message);
    }
  } else {
    console.warn("⚠️  WEBHOOK_URL non défini. Configurez-le dans .env");
  }
});