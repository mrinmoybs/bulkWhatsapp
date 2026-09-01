const socket = io();

let templates = [];
let campaigns = [];
let campaignContacts = [];
let selectedContactIds = new Set();
let serverContacts = [];

// --- Socket Events ---
socket.on('status', (data) => {
  const statusEl = document.getElementById('connection-status');
  const textEl = document.getElementById('status-text');
  const qrSection = document.getElementById('qr-section');
  const logoutBtn = document.getElementById('logout-btn');

  statusEl.className = 'status ' + (data.state === 'ready' ? 'connected' : data.state === 'qr' ? 'pending' : 'disconnected');
  textEl.textContent = data.message;
  qrSection.classList.toggle('hidden', data.state !== 'qr');
  logoutBtn.style.display = data.state === 'ready' ? 'block' : 'none';
});

socket.on('qr', (qr) => {
  const qrEl = document.getElementById('qr-code');
  qrEl.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qr)}" alt="QR Code">`;
});

socket.on('campaign-update', (data) => {
  const campaign = campaigns.find(c => c.id === data.campaignId);
  if (campaign) {
    const idx = campaign.results.findIndex(r => r.contactId === data.result.contactId);
    if (idx !== -1) campaign.results[idx] = data.result;
    renderCampaigns();
  }
});

socket.on('campaign-done', (data) => {
  const campaign = campaigns.find(c => c.id === data.campaignId);
  if (campaign) {
    campaign.status = 'completed';
    renderCampaigns();
  }
});

// --- Tabs ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
  });
});

// --- Logout ---
async function logoutWhatsApp() {
  if (!confirm('Logout from WhatsApp? You will need to scan QR again.')) return;
  await fetch('/api/logout', { method: 'POST' });
}

// --- Reconnect ---
async function reconnectWhatsApp() {
  await fetch('/api/reconnect', { method: 'POST' });
}

// --- Templates ---
async function loadTemplates() {
  const res = await fetch('/api/templates');
  templates = await res.json();
  renderTemplates();
}

function renderTemplates() {
  const list = document.getElementById('templates-list');
  const noMsg = document.getElementById('no-templates');

  if (templates.length === 0) {
    list.innerHTML = '';
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');
  list.innerHTML = templates.map(t => `
    <div class="template-card">
      <div class="template-card-header">
        <h3>${escapeHtml(t.name)}</h3>
        <button class="btn btn-danger btn-sm" onclick="deleteTemplate('${t.id}')">Delete</button>
      </div>
      <div class="template-text">${escapeHtml(t.text)}</div>
    </div>
  `).join('');
}

document.getElementById('add-template-btn').addEventListener('click', () => {
  document.getElementById('add-template-form').classList.toggle('hidden');
});

document.getElementById('cancel-template-btn').addEventListener('click', () => {
  document.getElementById('add-template-form').classList.add('hidden');
  document.getElementById('template-name').value = '';
  document.getElementById('template-text').value = '';
});

document.getElementById('save-template-btn').addEventListener('click', async () => {
  const name = document.getElementById('template-name').value.trim();
  const text = document.getElementById('template-text').value.trim();
  if (!name || !text) return alert('Please fill in all fields');

  await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text })
  });

  document.getElementById('template-name').value = '';
  document.getElementById('template-text').value = '';
  document.getElementById('add-template-form').classList.add('hidden');
  loadTemplates();
});

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await fetch(`/api/templates/${id}`, { method: 'DELETE' });
  loadTemplates();
}

// --- Campaigns ---
async function loadCampaigns() {
  const [campaignsRes, contactsRes] = await Promise.all([
    fetch('/api/campaigns'),
    fetch('/api/contacts')
  ]);
  campaigns = await campaignsRes.json();
  serverContacts = await contactsRes.json();
  renderCampaigns();
}

function renderCampaigns() {
  const list = document.getElementById('campaigns-list');
  const noMsg = document.getElementById('no-campaigns');

  if (campaigns.length === 0) {
    list.innerHTML = '';
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');

  const sorted = [...campaigns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  list.innerHTML = sorted.map(c => {
    const sent = c.results.filter(r => r.status === 'sent').length;
    const failed = c.results.filter(r => r.status === 'failed').length;
    const total = c.results.length;
    const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
    const time = new Date(c.createdAt).toLocaleString();

    return `
      <div class="mail-item ${c.status === 'pending' ? 'unread' : ''}">
        <div class="mail-item-header">
          <span class="mail-item-title">${escapeHtml(c.name)}</span>
          <span class="mail-item-time">${time}</span>
        </div>
        <div class="mail-item-meta">
          <span class="badge ${c.status}">${c.status}</span>
          <span>${total} contacts</span>
          <span>Delay: ${c.delay}s</span>
          ${sent > 0 ? `<span style="color:#25d366">${sent} sent</span>` : ''}
          ${failed > 0 ? `<span style="color:#dc3545">${failed} failed</span>` : ''}
        </div>
        ${c.status === 'sending' ? `
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        ` : ''}
        ${c.status === 'completed' ? `
          <div class="results-panel">
            ${c.results.map(r => {
              const contact = (serverContacts.find(ct => ct.id === r.contactId) || {});
              return `<div class="result-item">
                <span>${escapeHtml(contact.name || 'Unknown')}</span>
                <span class="badge ${r.status}">${r.status}${r.error ? ': ' + r.error : ''}</span>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
        <div class="mail-item-actions">
          ${c.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="sendCampaign('${c.id}')">Send Now</button>` : ''}
          ${c.status === 'completed' || c.status === 'failed' ? `<button class="btn btn-danger btn-sm" onclick="deleteCampaign('${c.id}')">Delete</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// --- New Campaign ---
document.getElementById('new-campaign-btn').addEventListener('click', () => {
  const form = document.getElementById('new-campaign-form');
  form.classList.toggle('hidden');

  if (!form.classList.contains('hidden')) {
    const select = document.getElementById('campaign-template');
    select.innerHTML = '<option value="">-- No Template (Media Only) --</option>' + templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    campaignContacts = [];
    document.getElementById('csv-filename').textContent = 'Choose CSV file...';
    document.getElementById('media-filename').textContent = 'Choose file...';
    document.getElementById('csv-preview').classList.add('hidden');
    document.getElementById('campaign-csv').value = '';
    document.getElementById('campaign-media').value = '';
  }
});

document.getElementById('cancel-campaign-btn').addEventListener('click', () => {
  document.getElementById('new-campaign-form').classList.add('hidden');
});

// CSV Preview
document.getElementById('campaign-csv').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('csv-filename').textContent = file.name;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    const lines = ev.target.result.split('\n').filter(l => l.trim());
    const parsed = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (i === 0 && (line.toLowerCase().includes('name') || line.toLowerCase().includes('phone'))) continue;
      const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
      if (parts.length >= 2 && parts[1]) {
        parsed.push({
          id: Date.now().toString() + i,
          name: parts[0] || 'Unknown',
          phone: parts[1]
        });
      }
    }

    if (parsed.length > 25) {
      alert(`CSV exceeds 25 contacts (${parsed.length} found). Please reduce the CSV to 25 or fewer contacts.`);
      document.getElementById('csv-filename').textContent = 'Choose CSV file...';
      document.getElementById('csv-preview').classList.add('hidden');
      campaignContacts = [];
      selectedContactIds.clear();
      return;
    }

    campaignContacts = parsed;

    // Check for duplicates against previously sent contacts
    let sentSet = new Set();
    try {
      const res = await fetch('/api/contacts/sent-phones');
      const sentPhones = await res.json();
      sentSet = new Set(sentPhones);
    } catch (err) {}

    // Default selection: all except duplicates
    selectedContactIds.clear();
    campaignContacts.forEach(c => {
      const phone = c.phone.replace(/[^0-9]/g, '');
      if (!sentSet.has(phone)) selectedContactIds.add(c.id);
    });

    renderCsvPreview(sentSet);
  };
  reader.readAsText(file);
});

function renderCsvPreview(sentSet) {
  const preview = document.getElementById('csv-preview');
  if (campaignContacts.length === 0) {
    preview.classList.add('hidden');
    return;
  }

  const duplicates = campaignContacts.filter(c => sentSet.has(c.phone.replace(/[^0-9]/g, '')));
  const selectedCount = campaignContacts.filter(c => selectedContactIds.has(c.id)).length;

  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <strong>${selectedCount}/${campaignContacts.length} contacts selected</strong>
      <label style="font-weight:normal;cursor:pointer;font-size:0.8rem">
        <input type="checkbox" id="select-all-contacts" ${selectedCount === campaignContacts.length ? 'checked' : ''}>
        Select All
      </label>
    </div>
    ${duplicates.length > 0 ? `<div style="color:#ff9800;margin-bottom:4px;font-size:0.8rem">${duplicates.length} duplicate(s) — already sent in a previous campaign (unchecked by default)</div>` : ''}
    ${campaignContacts.map(c => {
      const phone = c.phone.replace(/[^0-9]/g, '');
      const isDup = sentSet.has(phone);
      const isSelected = selectedContactIds.has(c.id);
      return `<div class="csv-row" style="${isDup ? 'color:#ff9800' : ''}">
        <input type="checkbox" class="contact-cb" data-id="${c.id}" ${isSelected ? 'checked' : ''} style="cursor:pointer">
        <span class="csv-name">${escapeHtml(c.name)}${isDup ? ' ⚠' : ''}</span>
        <span class="csv-phone">${escapeHtml(c.phone)}</span>
      </div>`;
    }).join('')}
  `;

  // Select All toggle
  document.getElementById('select-all-contacts').addEventListener('change', (e) => {
    if (e.target.checked) {
      campaignContacts.forEach(c => selectedContactIds.add(c.id));
    } else {
      selectedContactIds.clear();
    }
    document.querySelectorAll('.contact-cb').forEach(cb => cb.checked = e.target.checked);
    document.querySelector('#csv-preview strong').textContent = `${selectedContactIds.size}/${campaignContacts.length} contacts selected`;
  });

  // Individual checkbox
  document.querySelectorAll('.contact-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        selectedContactIds.add(id);
      } else {
        selectedContactIds.delete(id);
      }
      const count = campaignContacts.filter(c => selectedContactIds.has(c.id)).length;
      document.querySelector('#csv-preview strong').textContent = `${count}/${campaignContacts.length} contacts selected`;
      document.getElementById('select-all-contacts').checked = count === campaignContacts.length;
    });
  });
}

// Media Preview
document.getElementById('campaign-media').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) document.getElementById('media-filename').textContent = file.name;
});

// Send Campaign
document.getElementById('send-campaign-btn').addEventListener('click', async () => {
  const name = document.getElementById('campaign-name').value.trim();
  const templateId = document.getElementById('campaign-template').value || null;
  const delay = parseInt(document.getElementById('campaign-delay').value) || 8;

  if (!name) return alert('Please enter a campaign name');
  if (campaignContacts.length === 0) return alert('Please import a CSV file with contacts');
  if (selectedContactIds.size === 0) return alert('Please select at least one contact');

  const mediaInput = document.getElementById('campaign-media');
  if (!templateId && mediaInput.files.length === 0) {
    return alert('Please select a template or attach a media file');
  }

  const selectedContacts = campaignContacts.filter(c => selectedContactIds.has(c.id));

  // Save contacts to server and collect server-generated IDs
  const contactIds = [];
  for (const contact of selectedContacts) {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: contact.name, phone: contact.phone })
    });
    const data = await res.json();
    contactIds.push(data.id);
  }

  // Upload media if selected
  let mediaUrl = null;
  if (mediaInput.files.length > 0) {
    const formData = new FormData();
    formData.append('media', mediaInput.files[0]);
    const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
    const uploadData = await uploadRes.json();
    if (uploadData.ok) mediaUrl = uploadData.path;
  }

  await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, contactIds, templateId, delay, mediaUrl })
  });

  document.getElementById('campaign-name').value = '';
  document.getElementById('new-campaign-form').classList.add('hidden');
  loadCampaigns();
});

async function sendCampaign(id) {
  if (!confirm('Start sending this campaign?')) return;
  const res = await fetch(`/api/campaigns/${id}/send`, { method: 'POST' });
  const data = await res.json();
  if (data.error) return alert('Error: ' + data.error);
  loadCampaigns();
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign?')) return;
  await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
  loadCampaigns();
}

// --- Helpers ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// --- Init ---
loadTemplates();
loadCampaigns();
