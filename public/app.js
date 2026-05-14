const authStatus = document.querySelector('#authStatus');
const userForm = document.querySelector('#userForm');
const registerBtn = document.querySelector('#registerBtn');
const snippetForm = document.querySelector('#snippetForm');
const snippetList = document.querySelector('#snippetList');
const adminForm = document.querySelector('#adminForm');
const adminDashboard = document.querySelector('#adminDashboard');
const toast = document.querySelector('#toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Terjadi kesalahan.');
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

async function refreshSession() {
  const session = await api('/api/session');
  authStatus.innerHTML = session.loggedIn
    ? `Login sebagai <strong>${escapeHtml(session.username)}</strong> (${session.role}) <button class="btn ghost" id="logoutBtn">Logout</button>`
    : 'Belum login';
  document.querySelector('#logoutBtn')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: '{}' });
    adminDashboard.classList.add('hidden');
    showToast('Logout berhasil.');
    refreshSession();
  });
}

function snippetCard(snippet) {
  return `
    <article class="snippet-card" data-id="${snippet.id}">
      <div>
        <div class="snippet-meta">
          <span class="badge">${escapeHtml(snippet.language)}</span>
          <span>oleh ${escapeHtml(snippet.username)}</span>
        </div>
        <h3>${escapeHtml(snippet.title)}</h3>
        <p class="muted">${escapeHtml(snippet.description)}</p>
      </div>
      <pre class="snippet-code"><code>Memuat kode...</code></pre>
      <div class="card-actions">
        <span class="stats">👁️ ${snippet.views} view • 📋 <span class="copy-count">${snippet.copies}</span> salin</span>
        <button class="btn primary copy-btn">Salin</button>
      </div>
    </article>
  `;
}

async function loadSnippets() {
  const snippets = await api('/api/snippets');
  snippetList.innerHTML = snippets.length ? snippets.map(snippetCard).join('') : '<p class="muted">Belum ada snippet. Jadilah uploader pertama.</p>';

  for (const card of snippetList.querySelectorAll('.snippet-card')) {
    const id = card.dataset.id;
    const detail = await api(`/api/snippets/${id}`);
    card.querySelector('code').textContent = detail.code;
    card.querySelector('.stats').firstChild.textContent = `👁️ ${detail.views} view • 📋 `;
    card.querySelector('.copy-btn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(detail.code);
      const copyResult = await api(`/api/snippets/${id}/copy`, { method: 'POST', body: '{}' });
      card.querySelector('.copy-count').textContent = copyResult.copies;
      showToast('Kode berhasil disalin.');
    });
  }
}

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify(formData(userForm)) });
    showToast(data.message);
    userForm.reset();
    refreshSession();
  } catch (error) {
    showToast(error.message);
  }
});

registerBtn.addEventListener('click', async () => {
  try {
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify(formData(userForm)) });
    showToast(data.message);
    userForm.reset();
    refreshSession();
  } catch (error) {
    showToast(error.message);
  }
});

snippetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/snippets', { method: 'POST', body: JSON.stringify(formData(snippetForm)) });
    showToast(data.message);
    snippetForm.reset();
    loadSnippets();
  } catch (error) {
    showToast(error.message);
  }
});

function renderAdmin(data) {
  adminDashboard.classList.remove('hidden');
  adminDashboard.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><span>User</span><strong>${data.totals.users}</strong></div>
      <div class="stat-box"><span>Snippet</span><strong>${data.totals.snippets}</strong></div>
      <div class="stat-box"><span>View</span><strong>${data.totals.views}</strong></div>
      <div class="stat-box"><span>Salin</span><strong>${data.totals.copies}</strong></div>
    </div>
    <div class="admin-list">
      ${data.snippets.map((snippet) => `
        <div class="admin-row">
          <div>
            <strong>${escapeHtml(snippet.title)}</strong>
            <p class="muted">${escapeHtml(snippet.language)} • ${escapeHtml(snippet.username)} • 👁️ ${snippet.views} • 📋 ${snippet.copies}</p>
          </div>
          <button class="btn danger" data-delete="${snippet.id}">Hapus</button>
        </div>
      `).join('') || '<p class="muted">Belum ada snippet untuk dimoderasi.</p>'}
    </div>
  `;
  adminDashboard.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/admin/snippets/${button.dataset.delete}`, { method: 'DELETE' });
      showToast('Snippet dihapus.');
      loadAdmin();
      loadSnippets();
    });
  });
}

async function loadAdmin() {
  const data = await api('/api/admin/stats');
  renderAdmin(data);
}

adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(formData(adminForm)) });
    showToast(data.message);
    adminForm.reset();
    await refreshSession();
    await loadAdmin();
  } catch (error) {
    showToast(error.message);
  }
});

refreshSession();
loadSnippets();
