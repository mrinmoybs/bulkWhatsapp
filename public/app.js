const socket = io();

let contacts = [];
let templates = [];
let campaigns = [];

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

// --- Logout ---
async function logoutWhatsApp() {
  if (!confirm('Logout from WhatsApp? You will need to scan QR again.')) return;
  await fetch('/api/logout', { method: 'POST' });
}

// --- Tabs ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
  });
});

// --- Contacts ---
async function loadContacts() {
  const res = await fetch('/api/contacts');
  contacts = await res.json();
  renderContacts();
}

function renderContacts() {
  const tbody = document.getElementById('contacts-body');
  const noMsg = document.getElementById('no-contacts');

  if (contacts.length === 0) {
    tbody.innerHTML = '';
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');
  tbody.innerHTML = contacts.map(c => `
    <tr>
      <td><input type="checkbox" class="contact-checkbox" value="${c.id}"></td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteContact('${c.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('add-contact-btn').addEventListener('click', () => {
  document.getElementById('add-contact-form').classList.toggle('hidden');
});

document.getElementById('cancel-contact-btn').addEventListener('click', () => {
  document.getElementById('add-contact-form').classList.add('hidden');
  document.getElementById('contact-name').value = '';
  document.getElementById('contact-phone').value = '';
});

document.getElementById('save-contact-btn').addEventListener('click', async () => {
  const name = document.getElementById('contact-name').value.trim();
  const phone = document.getElementById('contact-phone').value.trim();
  if (!name || !phone) return alert('Please fill in all fields');

  await fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone })
  });

  document.getElementById('contact-name').value = '';
  document.getElementById('contact-phone').value = '';
  document.getElementById('add-contact-form').classList.add('hidden');
  loadContacts();
});

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
  loadContacts();
}

document.getElementById('clear-contacts-btn').addEventListener('click', async () => {
  if (!confirm('Delete ALL contacts? This cannot be undone.')) return;
  await fetch('/api/contacts', { method: 'DELETE' });
  loadContacts();
});

document.getElementById('import-csv-btn').addEventListener('click', () => {
  document.getElementById('csv-input').click();
});

document.getElementById('csv-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/contacts/import', { method: 'POST', body: formData });
  const data = await res.json();

  if (data.ok) {
    alert(`Imported ${data.imported} contacts`);
    loadContacts();
  } else {
    alert('Import failed: ' + data.error);
  }

  e.target.value = '';
});

document.getElementById('select-all-contacts').addEventListener('change', (e) => {
  document.querySelectorAll('.contact-checkbox').forEach(cb => {
    cb.checked = e.target.checked;
  });
});

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
      <div style="display:flex;justify-content:space-between;align-items:center">
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
  const res = await fetch('/api/campaigns');
  campaigns = await res.json();
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
  list.innerHTML = campaigns.map(c => {
    const sent = c.results.filter(r => r.status === 'sent').length;
    const failed = c.results.filter(r => r.status === 'failed').length;
    const total = c.results.length;
    const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

    return `
      <div class="campaign-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3>${escapeHtml(c.name)}</h3>
          <div>
            <span class="campaign-status ${c.status}">${c.status}</span>
            ${c.status === 'pending' ? `<button class="btn btn-primary" style="margin-left:8px;background:#25d366;color:white;padding:8px 20px;border:none;border-radius:6px;cursor:pointer;font-size:0.9rem" onclick="sendCampaign('${c.id}')">Send Now</button>` : ''}
            ${c.status === 'completed' || c.status === 'failed' ? `<button class="btn btn-danger btn-sm" style="margin-left:8px" onclick="deleteCampaign('${c.id}')">Delete</button>` : ''}
          </div>
        </div>
        <div class="campaign-meta">
          <span>Template: ${getTemplateName(c.templateId)}</span>
          <span>Delay: ${c.delay}s</span>
          <span>Contacts: ${total}</span>
        </div>
        ${c.status === 'sending' ? `
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <span style="font-size:0.85rem;color:#666">${sent}/${total} sent, ${failed} failed</span>
        ` : ''}
        ${c.status === 'completed' ? `
          <div class="result-list">
            ${c.results.map(r => {
              const contact = contacts.find(ct => ct.id === r.contactId);
              return `<div class="result-item">
                <span>${contact ? escapeHtml(contact.name) : 'Unknown'}</span>
                <span class="badge ${r.status}">${r.status}${r.error ? ': ' + escapeHtml(r.error) : ''}</span>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function getTemplateName(id) {
  const t = templates.find(t => t.id === id);
  return t ? t.name : 'Unknown';
}

document.getElementById('new-campaign-btn').addEventListener('click', () => {
  const form = document.getElementById('new-campaign-form');
  form.classList.toggle('hidden');

  if (!form.classList.contains('hidden')) {
    const select = document.getElementById('campaign-template');
    select.innerHTML = templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

    const contactList = document.getElementById('campaign-contacts');
    contactList.innerHTML = contacts.map(c => `
      <label>
        <input type="checkbox" class="campaign-contact-cb" value="${c.id}">
        ${escapeHtml(c.name)} (${escapeHtml(c.phone)})
      </label>
    `).join('');

    document.getElementById('select-all-campaign-contacts').checked = false;
  }
});

document.getElementById('select-all-campaign-contacts').addEventListener('change', (e) => {
  document.querySelectorAll('.campaign-contact-cb').forEach(cb => {
    cb.checked = e.target.checked;
  });
});

document.getElementById('cancel-campaign-btn').addEventListener('click', () => {
  document.getElementById('new-campaign-form').classList.add('hidden');
});

document.getElementById('save-campaign-btn').addEventListener('click', async () => {
  const name = document.getElementById('campaign-name').value.trim();
  const templateId = document.getElementById('campaign-template').value;
  const delay = parseInt(document.getElementById('campaign-delay').value) || 5;
  const contactIds = Array.from(document.querySelectorAll('.campaign-contact-cb:checked')).map(cb => cb.value);

  if (!name) return alert('Please enter a campaign name');
  if (!templateId) return alert('Please select a template');
  if (contactIds.length === 0) return alert('Please select at least one contact');

  const mediaInput = document.getElementById('campaign-media');
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
loadContacts();
loadTemplates();
loadCampaigns();
