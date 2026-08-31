const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
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

let whatsappClient = null;
let isWhatsAppReady = false;

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function initWhatsApp() {
  const chromePath = findChrome();
  const puppeteerConfig = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
  if (chromePath) puppeteerConfig.executablePath = chromePath;

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: puppeteerConfig
  });

  whatsappClient.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    io.emit('qr', qr);
    io.emit('status', { state: 'qr', message: 'Scan QR code with WhatsApp' });
  });

  whatsappClient.on('ready', () => {
    isWhatsAppReady = true;
    io.emit('status', { state: 'ready', message: 'WhatsApp Connected' });
    console.log('WhatsApp client ready!');
  });

  whatsappClient.on('authenticated', () => {
    io.emit('status', { state: 'authenticated', message: 'Authenticated...' });
  });

  whatsappClient.on('auth_failure', (msg) => {
    isWhatsAppReady = false;
    io.emit('status', { state: 'error', message: 'Authentication failed' });
    console.error('Auth failure:', msg);
  });

  whatsappClient.on('disconnected', () => {
    isWhatsAppReady = false;
    io.emit('status', { state: 'disconnected', message: 'WhatsApp Disconnected' });
    console.log('WhatsApp disconnected');
  });

  whatsappClient.initialize();
}

// --- API Routes ---

app.get('/api/status', (req, res) => {
  res.json({ ready: isWhatsAppReady });
});

app.post('/api/reconnect', (req, res) => {
  if (whatsappClient) {
    whatsappClient.destroy().then(() => initWhatsApp());
  } else {
    initWhatsApp();
  }
  res.json({ ok: true });
});

app.post('/api/logout', async (req, res) => {
  if (whatsappClient) {
    try {
      await whatsappClient.logout();
      await whatsappClient.destroy();
    } catch (e) {}
    whatsappClient = null;
    isWhatsAppReady = false;
    io.emit('status', { state: 'disconnected', message: 'Logged out' });
  }
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

  // Send in background
  sendCampaign(campaign, contacts, template);
});

async function sendCampaign(campaign, contacts, template) {
  const campaigns = readJSON(campaignsFile);
  const idx = campaigns.findIndex(c => c.id === campaign.id);

  for (const result of campaign.results) {
    const contact = contacts.find(c => c.id === result.contactId);
    if (!contact) {
      result.status = 'failed';
      result.error = 'Contact not found';
      result.sentAt = new Date().toISOString();
      io.emit('campaign-update', { campaignId: campaign.id, result });
      continue;
    }

    const phone = contact.phone.replace(/[^0-9]/g, '');
    const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;

    let messageText = template.text;
    messageText = messageText.replace(/\{\{name\}\}/gi, contact.name);
    messageText = messageText.replace(/\{\{phone\}\}/gi, contact.phone);

    try {
      if (campaign.mediaUrl && fs.existsSync(campaign.mediaUrl)) {
        const media = MessageMedia.fromFilePath(campaign.mediaUrl);
        await whatsappClient.sendMessage(chatId, media, { caption: messageText });
      } else {
        await whatsappClient.sendMessage(chatId, messageText);
      }
      result.status = 'sent';
      result.sentAt = new Date().toISOString();
    } catch (err) {
      result.status = 'failed';
      result.error = err.message;
      result.sentAt = new Date().toISOString();
    }

    io.emit('campaign-update', { campaignId: campaign.id, result });

    campaigns[idx] = campaign;
    writeJSON(campaignsFile, campaigns);

    await new Promise(r => setTimeout(r, (campaign.delay || 5) * 1000));
  }

  campaign.status = 'completed';
  campaigns[idx] = campaign;
  writeJSON(campaignsFile, campaigns);
  io.emit('campaign-done', { campaignId: campaign.id });
}

// Media upload
app.post('/api/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ ok: true, path: req.file.path, filename: req.file.filename });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('status', {
    state: isWhatsAppReady ? 'ready' : 'disconnected',
    message: isWhatsAppReady ? 'WhatsApp Connected' : 'WhatsApp Disconnected'
  });
});

// Start
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  initWhatsApp();
});
