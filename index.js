require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;

// URL 1 : Vérification abonnement — MOHS TECHNOLOGIE (fixe, ne pas changer)
const URL_VERIFICATION = 'https://script.google.com/macros/s/AKfycbxMAqw97qww0rQXce-wn4RIvD30HgZSwHV_PpVJbnNeqecwQqcgjmSHCvNOz38-92mN/exec';

// URL 2 : Votre propre Google Sheet (ventes, stock, CA...)
const URL_SHEET = process.env.APPS_SCRIPT_URL || 'https://script.google.com/a/macros/mohstechnologie.com/s/AKfycbzpxQertMqixHslEWAhu6QHMuuIobpgoBwDoBqQuaItjFKPWX-rQCO6kquxFFKaTMRD/exec';
const SECRET    = process.env.SECRET || 'MOHS_SECRET_2024';

// ID client fourni par MOHS TECHNOLOGIE (format MT-XXXXX)
const CLIENT_ID = process.env.CLIENT_ID || 'MT-EPKGH';

const MSG_EXPIRE =
  `❌ Votre abonnement n'est pas actif.\n\n` +
  `Veuillez contacter *MOHS TECHNOLOGIE* pour le renouveler :\n` +
  `📧 contact@mohstechnologie.com`;

if (!BOT_TOKEN)  { console.error('❌ BOT_TOKEN manquant dans .env');       process.exit(1); }
if (!URL_SHEET)  { console.error('❌ APPS_SCRIPT_URL manquant dans .env'); process.exit(1); }
if (!CLIENT_ID)  { console.error('❌ CLIENT_ID manquant dans .env');       process.exit(1); }

const bot      = new TelegramBot(BOT_TOKEN, { polling: true });
const sessions = {};

console.log('✅ Bot Client DEAL SURFACE démarré');

// ─── APPEL SHEET CLIENT ───────────────────────────────────────────────────────
// Toutes les opérations métier passent par URL_SHEET (votre sheet)
async function sheet(action, params = {}) {
  const res = await axios.post(URL_SHEET,
    { secret: SECRET, action, ...params },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  if (res.data?.error) throw new Error(res.data.error);
  return res.data;
}

// ─── VÉRIFICATION ABONNEMENT ─────────────────────────────────────────────────
// Appel vers URL_VERIFICATION (différente de URL_SHEET)
// RÈGLE ABSOLUE : appelée avant chaque réponse du bot
async function verifierAbonnement() {
  try {
    const res = await axios.post(URL_VERIFICATION,
      { action: 'check_abonnement', id: CLIENT_ID },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const statut = res.data?.statut;
    // Seul ACTIF autorise l'accès
    return statut === 'ACTIF';
  } catch (err) {
    console.error('[Vérification abonnement] Erreur:', err.message);
    return false; // bloquer si l'URL ne répond pas
  }
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
// Enveloppe chaque handler — si abonnement non ACTIF, on bloque tout
async function garde(chatId, fn) {
  const actif = await verifierAbonnement();

  if (!actif) {
    await bot.sendMessage(chatId, MSG_EXPIRE, { parse_mode: 'Markdown' });
    return;
  }

  try {
    await fn();
  } catch (err) {
    console.error('[Handler]', err.message);
    await bot.sendMessage(chatId, `⚠️ Erreur: ${err.message}`);
  }
}

// ─── UTILITAIRES ──────────────────────────────────────────────────────────────
const formatDate    = d => d ? new Date(d).toLocaleDateString('fr-FR') : 'N/A';
const formatMontant = m => (m || m === 0) ? Number(m).toLocaleString('fr-FR') + ' FCFA' : 'N/A';
const aujourd_hui   = () => new Date().toISOString().split('T')[0];

// ─── MENU PRINCIPAL ───────────────────────────────────────────────────────────
const MENU = {
  reply_markup: {
    keyboard: [
      [{ text: '🛒 Nouvelle vente'  }, { text: '📦 Voir le stock'  }],
      [{ text: '📊 Mon CA'          }, { text: '📈 Performances'   }],
      [{ text: '➕ Ajouter produit' }, { text: '🔄 Restock'        }],
    ],
    resize_keyboard: true,
    persistent: true,
  },
};

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async msg => {
  await garde(msg.chat.id, async () => {
    await bot.sendMessage(msg.chat.id,
      `✅ Bonjour *${msg.from.first_name}* !\n\nBienvenue sur *DEAL SURFACE*.\nQue souhaitez-vous faire ?`,
      { parse_mode: 'Markdown', ...MENU }
    );
  });
});

// ─── VOIR LE STOCK ────────────────────────────────────────────────────────────
bot.onText(/📦 Voir le stock/, async msg => {
  await garde(msg.chat.id, async () => {
    const stock = await sheet('GET_STOCK');
    let texte   = `📦 *STOCK DEAL SURFACE*\n${'─'.repeat(28)}\n`;
    if (!stock?.length) {
      texte += 'Aucun produit en stock.';
    } else {
      stock.forEach(p => {
        const alerte = p.quantite <= 2 ? ' ⚠️ Stock bas !' : '';
        texte += `▪️ *${p.nom}*${alerte}\n`;
        texte += `   Qté: *${p.quantite}* | Prix: ${formatMontant(p.prix)}\n\n`;
      });
    }
    await bot.sendMessage(msg.chat.id, texte, { parse_mode: 'Markdown' });
  });
});

// ─── MON CA ───────────────────────────────────────────────────────────────────
bot.onText(/📊 Mon CA/, async msg => {
  await garde(msg.chat.id, async () => {
    const [jour, mois, annee] = await Promise.all([
      sheet('GET_STATS_CA', { periode: 'jour'  }),
      sheet('GET_STATS_CA', { periode: 'mois'  }),
      sheet('GET_STATS_CA', { periode: 'annee' }),
    ]);
    const texte =
      `📊 *CHIFFRE D'AFFAIRES*\n${'─'.repeat(28)}\n` +
      `📅 Aujourd'hui:  *${formatMontant(jour?.total  || 0)}*\n` +
      `🗓  Ce mois:      *${formatMontant(mois?.total  || 0)}* (${mois?.nombre || 0} ventes)\n` +
      `📆 Cette année:  *${formatMontant(annee?.total || 0)}*`;
    await bot.sendMessage(msg.chat.id, texte, { parse_mode: 'Markdown' });
  });
});

// ─── PERFORMANCES ─────────────────────────────────────────────────────────────
bot.onText(/📈 Performances/, async msg => {
  await garde(msg.chat.id, async () => {
    const ventes = await sheet('GET_VENTES_RECENTES', { limite: 10 });
    let texte    = `📈 *DERNIÈRES VENTES*\n${'─'.repeat(28)}\n`;
    if (!ventes?.length) {
      texte += 'Aucune vente enregistrée.';
    } else {
      ventes.forEach((v, i) => {
        texte +=
          `${i + 1}. *${v.article}*\n` +
          `   👤 ${v.nom_complet} | ${formatDate(v.date_vente)}\n` +
          `   💰 ${formatMontant(v.montant_fcfa)} — ${v.type_vente || 'VENTE'}\n\n`;
      });
    }
    await bot.sendMessage(msg.chat.id, texte, { parse_mode: 'Markdown' });
  });
});

// ─── AJOUTER PRODUIT ──────────────────────────────────────────────────────────
bot.onText(/➕ Ajouter produit/, async msg => {
  await garde(msg.chat.id, async () => {
    sessions[msg.chat.id] = { etape: 'prod_nom', data: {} };
    await bot.sendMessage(msg.chat.id,
      `➕ *Nouveau produit*\n_Étape 1/4_\n\n📝 Nom du produit ?`,
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } }
    );
  });
});

// ─── RESTOCK ─────────────────────────────────────────────────────────────────
bot.onText(/🔄 Restock/, async msg => {
  await garde(msg.chat.id, async () => {
    const stock = await sheet('GET_STOCK');
    if (!stock?.length) return bot.sendMessage(msg.chat.id, '❌ Aucun produit dans le stock.');
    sessions[msg.chat.id] = { etape: 'restock_choix', stock };
    await bot.sendMessage(msg.chat.id,
      `🔄 *Restock*\nChoisissez le produit à restocker :`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: stock.map(p => ([{
            text: `${p.nom} (Qté: ${p.quantite})`,
            callback_data: `restock:${p.id}`,
          }])),
        },
      }
    );
  });
});

// ─── NOUVELLE VENTE ───────────────────────────────────────────────────────────
bot.onText(/🛒 Nouvelle vente/, async msg => {
  await garde(msg.chat.id, async () => {
    const stock = await sheet('GET_STOCK');
    const dispo = stock?.filter(p => p.quantite > 0);
    if (!dispo?.length) return bot.sendMessage(msg.chat.id, '❌ Stock vide ou produits épuisés.');
    sessions[msg.chat.id] = { etape: 'vente_produit', stock, data: {} };
    await bot.sendMessage(msg.chat.id,
      `🛒 *Nouvelle vente*\nChoisissez le produit vendu :`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: dispo.map(p => ([{
            text: `${p.nom} (Stock: ${p.quantite})`,
            callback_data: `vente_prod:${p.id}`,
          }])),
        },
      }
    );
  });
});

// ─── MESSAGES LIBRES (multi-étapes) ──────────────────────────────────────────
bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const session = sessions[msg.chat.id];
  if (!session) return;

  await garde(msg.chat.id, async () => {
    const texte  = msg.text.trim();
    const chatId = msg.chat.id;

    // ── Création produit ───────────────────────────────────────────────────────
    if (session.etape === 'prod_nom') {
      session.data.nom  = texte;
      session.etape     = 'prod_prix';
      bot.sendMessage(chatId,
        `✅ Nom: *${texte}*\n\n_Étape 2/4_\n💰 Prix de vente en FCFA ?`,
        { parse_mode: 'Markdown' }
      );

    } else if (session.etape === 'prod_prix') {
      const prix = parseInt(texte.replace(/\s/g, ''));
      if (isNaN(prix) || prix <= 0) return bot.sendMessage(chatId, '❌ Prix invalide. Entrez un nombre.');
      session.data.prix_vente = prix;
      session.etape           = 'prod_qte';
      bot.sendMessage(chatId,
        `✅ Prix: *${formatMontant(prix)}*\n\n_Étape 3/4_\n📦 Quantité en stock ?`,
        { parse_mode: 'Markdown' }
      );

    } else if (session.etape === 'prod_qte') {
      const qte = parseInt(texte);
      if (isNaN(qte) || qte < 0) return bot.sendMessage(chatId, '❌ Quantité invalide.');
      session.data.quantite = qte;
      session.etape         = 'prod_carac';
      bot.sendMessage(chatId,
        `✅ Quantité: *${qte}*\n\n_Étape 4/4_\n🔧 Caractéristiques ? _(ex: 256GB RAM 8GB)_\n_(Envoyez - pour ignorer)_`,
        { parse_mode: 'Markdown' }
      );

    } else if (session.etape === 'prod_carac') {
      session.data.caracteristiques = texte === '-' ? '' : texte;
      const d = session.data;
      delete sessions[chatId];
      await sheet('AJOUTER_PRODUIT', { data: { ...d, alerte_min: 2 } });
      bot.sendMessage(chatId,
        `✅ *Produit ajouté !*\n\n📦 *${d.nom}*\n💰 ${formatMontant(d.prix_vente)}\n🔢 Stock initial: ${d.quantite}`,
        { parse_mode: 'Markdown', ...MENU }
      );

    // ── Vente ──────────────────────────────────────────────────────────────────
    } else if (session.etape === 'vente_nom') {
      session.data.nom_complet = texte;
      session.etape            = 'vente_tel';
      bot.sendMessage(chatId, `✅ Client: *${texte}*\n\n📞 Téléphone ?`, { parse_mode: 'Markdown' });

    } else if (session.etape === 'vente_tel') {
      session.data.telephone = texte;
      session.etape          = 'vente_qte';
      bot.sendMessage(chatId, `✅ Tél: *${texte}*\n\n🔢 Quantité vendue ?`, { parse_mode: 'Markdown' });

    } else if (session.etape === 'vente_qte') {
      const qte     = parseInt(texte);
      const produit = session.stock.find(p => p.id === session.data.produit_id);
      if (isNaN(qte) || qte <= 0) return bot.sendMessage(chatId, '❌ Quantité invalide.');
      if (qte > produit.quantite)  return bot.sendMessage(chatId, `❌ Stock insuffisant. Disponible: *${produit.quantite}*`, { parse_mode: 'Markdown' });
      session.data.quantite     = qte;
      session.data.montant_fcfa = qte * produit.prix;
      session.etape             = 'vente_type';
      bot.sendMessage(chatId,
        `✅ Quantité: *${qte}*\nMontant: *${formatMontant(session.data.montant_fcfa)}*\n\n💳 Type de vente ?`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
          [{ text: '💵 Vente normale', callback_data: 'type_vente:VENTE'  }],
          [{ text: '🔄 Troc',          callback_data: 'type_vente:TROC'   }],
          [{ text: '📋 Crédit',        callback_data: 'type_vente:CREDIT' }],
        ]}}
      );

    } else if (session.etape === 'vente_imei') {
      session.data.imei = texte === '-' ? '' : texte;
      const d           = session.data;
      const produit     = session.stock.find(p => p.id === d.produit_id);
      delete sessions[chatId];
      await sheet('ENREGISTRER_VENTE', { data: {
        ...d,
        article:       produit.nom,
        prix_unitaire: produit.prix,
        date_vente:    aujourd_hui(),
      }});
      bot.sendMessage(chatId,
        `✅ *Vente enregistrée !*\n\n` +
        `🛒 *${produit.nom}*\n` +
        `👤 ${d.nom_complet} | 📞 ${d.telephone}\n` +
        `💰 *${formatMontant(d.montant_fcfa)}*\n` +
        `📋 ${d.type_vente} | 📅 ${formatDate(aujourd_hui())}`,
        { parse_mode: 'Markdown', ...MENU }
      );

    // ── Restock — quantité ────────────────────────────────────────────────────
    } else if (session.etape === 'restock_qte') {
      const qte = parseInt(texte);
      if (isNaN(qte) || qte <= 0) return bot.sendMessage(chatId, '❌ Quantité invalide.');
      const { produitId } = session.data;
      delete sessions[chatId];
      await sheet('UPDATE_STOCK', { produitId, delta: qte });
      bot.sendMessage(chatId,
        `✅ *Restock effectué !*\n+${qte} unité(s) ajoutée(s) au stock.`,
        { parse_mode: 'Markdown', ...MENU }
      );
    }
  });
});

// ─── CALLBACKS INLINE ────────────────────────────────────────────────────────
bot.on('callback_query', async query => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const data   = query.data;
  await bot.answerCallbackQuery(query.id);

  // Vérification abonnement également sur les boutons
  await garde(chatId, async () => {

    // ── Produit choisi pour une vente ─────────────────────────────────────────
    if (data.startsWith('vente_prod:')) {
      const produitId = data.split(':')[1];
      const session   = sessions[chatId];
      if (!session) return;
      session.data.produit_id = produitId;
      session.etape           = 'vente_nom';
      const produit = session.stock.find(p => p.id === produitId);
      await bot.editMessageText(
        `🛒 *${produit.nom}*\nStock dispo: *${produit.quantite}*\n\n👤 Nom complet du client ?`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
      );

    // ── Type de vente ─────────────────────────────────────────────────────────
    } else if (data.startsWith('type_vente:')) {
      const typeVente = data.split(':')[1];
      const session   = sessions[chatId];
      if (!session) return;
      session.data.type_vente = typeVente;
      session.etape           = 'vente_imei';
      await bot.editMessageText(
        `✅ Type: *${typeVente}*\n\n📱 IMEI de l'appareil ?\n_(Envoyez - pour ignorer)_`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
      );

    // ── Produit choisi pour restock ───────────────────────────────────────────
    } else if (data.startsWith('restock:')) {
      const produitId = data.split(':')[1];
      sessions[chatId] = { etape: 'restock_qte', data: { produitId } };
      await bot.editMessageText(
        `🔄 *Restock*\n\n🔢 Combien d'unités à ajouter au stock ?`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
      );
    }
  });
});

bot.on('polling_error', err => console.error('[Polling]', err.message));