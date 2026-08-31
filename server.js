const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AUTH_DIR = path.join(__dirname, '.baileys_auth');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

const contactsFile = path.join(DATA_DIR, 'contacts.json');
const templatesFile = path.join(DATA_DIR, 'templates.json');
const campaignsFile = path.join(DATA_DIR, 'campaigns.json');

function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let sock = null;
let isWhatsAppReady = false;

async function initWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['Bulk WhatsApp Sender', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      io.emit('qr', qr);
      io.emit('status', { state: 'qr', message: 'Scan QR code with WhatsApp' });
    }

    if (connection === 'open') {
      isWhatsAppReady = true;
      io.emit('status', { state: 'ready', message: 'WhatsApp Connected' });
      console.log('WhatsApp connected!');
    }

    if (connection === 'close') {
      isWhatsAppReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        io.emit('status', { state: 'disconnected', message: 'Logged out. Scan QR again.' });
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true });
      } else {
        io.emit('status', { state: 'disconnected', message: 'Disconnected. Reconnecting...' });
      }

      setTimeout(() => initWhatsApp(), 3000);
    }
  });
}

// --- API Routes ---

app.get('/api/status', (req, res) => {
  res.json({ ready: isWhatsAppReady });
});

app.post('/api/reconnect', async (req, res) => {
  if (sock) {
    try { sock.end(); } catch (e) {}
  }
  isWhatsAppReady = false;
  setTimeout(() => initWhatsApp(), 1000);
  res.json({ ok: true });
});

app.post('/api/logout', async (req, res) => {
  if (sock) {
    try { sock.logout(); } catch (e) {}
    try { sock.end(); } catch (e) {}
    sock = null;
    isWhatsAppReady = false;
  }
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true });
  io.emit('status', { state: 'disconnected', message: 'Logged out' });
  res.json({ ok: true });
});

// Contacts
app.get('/api/contacts', (req, res) => {
  res.json(readJSON(contactsFile));
});

app.post('/api/contacts', (req, res) => {
  const contacts = readJSON(contactsFile);
  const { name, phone } = req.body;
  const id = Date.now().toString();
  contacts.push({ id, name, phone, createdAt: new Date().toISOString() });
  writeJSON(contactsFile, contacts);
  res.json({ ok: true, id });
});

app.put('/api/contacts/:id', (req, res) => {
  const contacts = readJSON(contactsFile);
  const idx = contacts.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  contacts[idx] = { ...contacts[idx], ...req.body };
  writeJSON(contactsFile, contacts);
  res.json({ ok: true });
});

app.delete('/api/contacts/:id', (req, res) => {
  let contacts = readJSON(contactsFile);
  contacts = contacts.filter(c => c.id !== req.params.id);
  writeJSON(contactsFile, contacts);
  res.json({ ok: true });
});

app.delete('/api/contacts', (req, res) => {
  writeJSON(contactsFile, []);
  res.json({ ok: true });
});

app.post('/api/contacts/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const contacts = readJSON(contactsFile);
    let imported = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (i === 0 && (line.toLowerCase().includes('name') || line.toLowerCase().includes('phone'))) continue;
      const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
      if (parts.length >= 2 && parts[1]) {
        contacts.push({
          id: Date.now().toString() + i,
          name: parts[0] || 'Unknown',
          phone: parts[1],
          createdAt: new Date().toISOString()
        });
        imported++;
      }
    }
    writeJSON(contactsFile, contacts);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Templates
app.get('/api/templates', (req, res) => {
  res.json(readJSON(templatesFile));
});

app.post('/api/templates', (req, res) => {
  const templates = readJSON(templatesFile);
  const { name, text } = req.body;
  const id = Date.now().toString();
  templates.push({ id, name, text, createdAt: new Date().toISOString() });
  writeJSON(templatesFile, templates);
  res.json({ ok: true, id });
});

app.delete('/api/templates/:id', (req, res) => {
  let templates = readJSON(templatesFile);
  templates = templates.filter(t => t.id !== req.params.id);
  writeJSON(templatesFile, templates);
  res.json({ ok: true });
});

// Campaigns
app.get('/api/campaigns', (req, res) => {
  res.json(readJSON(campaignsFile));
});

app.post('/api/campaigns', (req, res) => {
  const campaigns = readJSON(campaignsFile);
  const { name, contactIds, templateId, delay, mediaUrl } = req.body;
  const id = Date.now().toString();
  const campaign = {
    id, name, contactIds, templateId, delay: delay || 5, mediaUrl: mediaUrl || null,
    status: 'pending',
    results: contactIds.map(cid => ({ contactId: cid, status: 'pending', sentAt: null, error: null })),
    createdAt: new Date().toISOString()
  };
  campaigns.push(campaign);
  writeJSON(campaignsFile, campaigns);
  res.json({ ok: true, id });
});

app.delete('/api/campaigns/:id', (req, res) => {
  let campaigns = readJSON(campaignsFile);
  campaigns = campaigns.filter(c => c.id !== req.params.id);
  writeJSON(campaignsFile, campaigns);
  res.json({ ok: true });
});

app.post('/api/campaigns/:id/send', async (req, res) => {
  if (!isWhatsAppReady) return res.status(400).json({ error: 'WhatsApp not connected' });

  const campaigns = readJSON(campaignsFile);
  const campaign = campaigns.find(c => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const contacts = readJSON(contactsFile);
  const templates = readJSON(templatesFile);
  const template = templates.find(t => t.id === campaign.templateId);

  if (!template) return res.status(400).json({ error: 'Template not found' });

  campaign.status = 'sending';
  writeJSON(campaignsFile, campaigns);

  res.json({ ok: true, message: 'Campaign sending started' });

  sendCampaign(campaign, contacts, template);
});

async function sendCampaign(campaign, contacts, template) {
  const campaigns = readJSON(campaignsFile);
  const idx = campaigns.findIndex(c => c.id === campaign.id);
  let consecutiveFails = 0;
  const MAX_CONSECUTIVE_FAILS = 5;

  for (const result of campaign.results) {
    if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      result.status = 'failed';
      result.error = 'Paused: Too many consecutive failures (possible ban)';
      result.sentAt = new Date().toISOString();
      io.emit('campaign-update', { campaignId: campaign.id, result });
      continue;
    }

    const contact = contacts.find(c => c.id === result.contactId);
    if (!contact) {
      result.status = 'failed';
      result.error = 'Contact not found';
      result.sentAt = new Date().toISOString();
      io.emit('campaign-update', { campaignId: campaign.id, result });
      continue;
    }

    const phone = contact.phone.replace(/[^0-9]/g, '');
    const jid = `${phone}@s.whatsapp.net`;

    try {
      const [exists] = await sock.onWhatsApp(jid);
      if (!exists) {
        result.status = 'failed';
        result.error = 'Number not on WhatsApp';
        result.sentAt = new Date().toISOString();
        io.emit('campaign-update', { campaignId: campaign.id, result });
        consecutiveFails++;
        continue;
      }
    } catch (err) {
      result.status = 'failed';
      result.error = 'Check failed: ' + err.message;
      result.sentAt = new Date().toISOString();
      io.emit('campaign-update', { campaignId: campaign.id, result });
      consecutiveFails++;
      continue;
    }

    let messageText = template.text;
    messageText = messageText.replace(/\{\{name\}\}/gi, contact.name);
    messageText = messageText.replace(/\{\{phone\}\}/gi, contact.phone);

    const variations = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
    messageText += variations[Math.floor(Math.random() * variations.length)];

    try {
      if (campaign.mediaUrl && fs.existsSync(campaign.mediaUrl)) {
        const mediaBuffer = fs.readFileSync(campaign.mediaUrl);
        const mimeType = getMimeType(campaign.mediaUrl);
        await sock.sendMessage(jid, {
          image: mediaBuffer,
          mimetype: mimeType,
          caption: messageText
        });
      } else {
        await sock.sendMessage(jid, { text: messageText });
      }
      result.status = 'sent';
      result.sentAt = new Date().toISOString();
      consecutiveFails = 0;
    } catch (err) {
      result.status = 'failed';
      result.error = err.message || 'Unknown error';
      result.sentAt = new Date().toISOString();
      consecutiveFails++;
    }

    io.emit('campaign-update', { campaignId: campaign.id, result });

    campaigns[idx] = campaign;
    writeJSON(campaignsFile, campaigns);

    const baseDelay = (campaign.delay || 5) * 1000;
    const randomDelay = baseDelay + (Math.random() * baseDelay * 0.6 - baseDelay * 0.3);
    await new Promise(r => setTimeout(r, Math.round(randomDelay)));
  }

  campaign.status = 'completed';
  campaigns[idx] = campaign;
  writeJSON(campaignsFile, campaigns);
  io.emit('campaign-done', { campaignId: campaign.id });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.avi': 'video/avi',
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return types[ext] || 'application/octet-stream';
}

app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ ok: true, path: req.file.path, filename: req.file.filename });
});

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('status', {
    state: isWhatsAppReady ? 'ready' : 'disconnected',
    message: isWhatsAppReady ? 'WhatsApp Connected' : 'Waiting for connection...'
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  initWhatsApp();
});
