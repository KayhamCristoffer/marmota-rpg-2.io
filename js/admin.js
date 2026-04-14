// ============================================================
// ADMIN.JS - Painel Administrativo com Supabase
// ============================================================
import { requireAuth, showToast, renderUserInSidebar } from '../supabase/session-manager.js';
import {
  getPendingSubmissions, approveSubmission, rejectSubmission,
  getAllQuests, createQuest, updateQuest, deleteQuest, toggleQuestActive,
  getAllMaps, createMap, updateMap, deleteMap,
  getAllAchievements, createAchievement, updateAchievement, deleteAchievement,
  getAllUsers, setUserRole,
  resetDailyRanking, resetWeeklyRanking, resetMonthlyRanking
} from '../supabase/database.js';

// ── State ────────────────────────────────────────────────────
let currentTab = 'submissions';

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const auth = await requireAuth(true); // admin required
  if (!auth) return;

  renderUserInSidebar(auth.profile);

  setupSidebar(auth);
  setupTabNavigation();
  setupResetButtons();
  await loadPanel('submissions');

  setTimeout(() => document.getElementById('pageLoader')?.classList.add('hide'), 600);
});

function setupSidebar(auth) {
  const toggle  = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('mainContent');
  const topMenu = document.getElementById('topbarMenu');

  toggle?.addEventListener('click', () => { sidebar?.classList.toggle('collapsed'); main?.classList.toggle('collapsed'); });
  topMenu?.addEventListener('click', () => sidebar?.classList.toggle('mobile-open'));
  document.getElementById('navLogout')?.addEventListener('click', async () => {
    const { signOut } = await import('../supabase/database.js');
    await signOut();
    window.location.href = 'index.html';
  });
  const av = document.getElementById('sidebarAvatar');
  if (av && auth.profile) av.textContent = (auth.profile.nickname || 'A')[0].toUpperCase();
  const nn = document.getElementById('sidebarNickname');
  if (nn) nn.textContent = auth.profile.nickname || 'Admin';
}

function setupTabNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      switchTab(tab);
      loadPanel(tab);
    });
  });
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item[data-tab]').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`panel-${tab}`)?.classList.add('active');
  currentTab = tab;
  const titles = { submissions:'Submissões', quests:'Quests', maps:'Mapas', achievements:'Conquistas', users:'Usuários', rankings:'Rankings' };
  const tt = document.getElementById('topbarTitle');
  if (tt) tt.textContent = `⚙️ ${titles[tab] || tab}`;
}

async function loadPanel(tab) {
  if (tab === 'submissions')  await loadSubmissions();
  if (tab === 'quests')       await loadQuests();
  if (tab === 'maps')         await loadMaps();
  if (tab === 'achievements') await loadAchievements();
  if (tab === 'users')        await loadUsers();
}

// ── SUBMISSIONS ───────────────────────────────────────────────
async function loadSubmissions() {
  const list = document.getElementById('submissionsList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando…</h3></div>';
  try {
    const subs = await getPendingSubmissions();
    const badge = document.getElementById('submissionsBadge');
    if (badge) badge.textContent = subs.length;
    if (!subs.length) { list.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><h3>Nenhuma submissão pendente</h3><p>Tudo em dia!</p></div>'; return; }
    list.innerHTML = subs.map(s => `
      <div class="submission-item" id="sub-${s.id}">
        <div style="display:flex;flex-direction:column;gap:4px;flex:1">
          <strong style="font-family:var(--font-title);color:var(--text-primary)">${s.users?.nickname || 'Usuário'}</strong>
          <span style="font-size:.8rem;color:var(--text-secondary)">Quest: ${s.quests?.title || s.quest_id}</span>
          <span style="font-size:.75rem;color:var(--text-muted)">${new Date(s.submitted_at).toLocaleString('pt-BR')} · +${s.quests?.reward_coins||0} moedas / +${s.quests?.reward_xp||0} XP</span>
        </div>
        ${s.proof_url ? `<img src="${s.proof_url}" class="proof-img" onclick="viewProof('${s.proof_url}')" title="Ver comprovante"/>` : '<span style="color:var(--text-muted);font-size:.8rem">Sem comprovante</span>'}
        <div class="submission-actions">
          <button class="btn-approve" onclick="handleApprove('${s.id}')"><i class="fas fa-check"></i> Aprovar</button>
          <button class="btn-reject"  onclick="handleReject('${s.id}')"><i class="fas fa-times"></i> Rejeitar</button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro: ${err.message}</h3></div>`;
  }
}

window.handleApprove = async function(subId) {
  if (!confirm('Aprovar esta submissão e conceder recompensas?')) return;
  try {
    await approveSubmission(subId);
    showToast('Submissão aprovada! Recompensas concedidas.', 'success');
    document.getElementById(`sub-${subId}`)?.remove();
    const badge = document.getElementById('submissionsBadge');
    if (badge) badge.textContent = Math.max(0, parseInt(badge.textContent || 0) - 1);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.handleReject = async function(subId) {
  if (!confirm('Rejeitar esta submissão?')) return;
  try {
    await rejectSubmission(subId);
    showToast('Submissão rejeitada.', 'info');
    document.getElementById(`sub-${subId}`)?.remove();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.viewProof = function(url) {
  const img = document.getElementById('proofModalImg');
  if (img) img.src = url;
  openModal('proofModal');
};

// ── QUESTS ────────────────────────────────────────────────────
async function loadQuests() {
  const list = document.getElementById('questsList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando…</h3></div>';
  try {
    const quests = await getAllQuests();
    if (!quests.length) { list.innerHTML = '<div class="empty-state"><i class="fas fa-scroll"></i><h3>Nenhuma quest criada</h3></div>'; return; }
    const typeLabels = { daily:'Diária', weekly:'Semanal', monthly:'Mensal', event:'Evento' };
    list.innerHTML = quests.map(q => `
      <div class="admin-item">
        <span style="font-size:1.5rem">${q.icon_url || '📜'}</span>
        <div style="flex:1">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${q.title}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">${typeLabels[q.type]||q.type} · +${q.reward_coins} moedas · +${q.reward_xp} XP · Nv${q.min_level}+ · ${q.is_active?'<span style="color:var(--green)">Ativa</span>':'<span style="color:var(--red)">Inativa</span>'}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm" onclick="openQuestModal('${q.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-sm" style="background:rgba(249,115,22,.15);border:1px solid rgba(249,115,22,.3);color:var(--orange);border-radius:var(--radius-sm);padding:6px 14px;font-size:.8rem" onclick="toggleQuest('${q.id}',${!q.is_active})">${q.is_active?'Desativar':'Ativar'}</button>
          <button class="btn-delete btn-sm" onclick="deleteQuestConfirm('${q.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro: ${err.message}</h3></div>`;
  }
}

window.openQuestModal = async function(questId) {
  clearForm(['questTitle','questDescription','questIcon','questEditId']);
  document.getElementById('questTitle').value = '';
  document.getElementById('questDescription').value = '';
  document.getElementById('questType').value = 'daily';
  document.getElementById('questMinLevel').value = 1;
  document.getElementById('questCoins').value = 0;
  document.getElementById('questXp').value = 0;
  document.getElementById('questActive').checked = true;
  document.getElementById('questImageRequired').checked = true;
  document.getElementById('questEditId').value = '';
  document.getElementById('questModalTitle').innerHTML = '<i class="fas fa-scroll"></i> Nova Quest';

  if (questId) {
    try {
      const quests = await getAllQuests();
      const q = quests.find(x => x.id === questId);
      if (q) {
        document.getElementById('questEditId').value = q.id;
        document.getElementById('questTitle').value = q.title;
        document.getElementById('questDescription').value = q.description || '';
        document.getElementById('questType').value = q.type;
        document.getElementById('questMinLevel').value = q.min_level || 1;
        document.getElementById('questCoins').value = q.reward_coins || 0;
        document.getElementById('questXp').value = q.reward_xp || 0;
        document.getElementById('questActive').checked = q.is_active;
        document.getElementById('questImageRequired').checked = q.image_required;
        document.getElementById('questIcon').value = q.icon_url || '';
        document.getElementById('questModalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Quest';
      }
    } catch (e) {}
  }
  openModal('questModal');
};

window.saveQuest = async function() {
  const editId = document.getElementById('questEditId').value;
  const data = {
    title:          document.getElementById('questTitle').value.trim(),
    description:    document.getElementById('questDescription').value.trim(),
    type:           document.getElementById('questType').value,
    min_level:      parseInt(document.getElementById('questMinLevel').value) || 1,
    reward_coins:   parseInt(document.getElementById('questCoins').value) || 0,
    reward_xp:      parseInt(document.getElementById('questXp').value) || 0,
    is_active:      document.getElementById('questActive').checked,
    image_required: document.getElementById('questImageRequired').checked,
    icon_url:       document.getElementById('questIcon').value.trim() || null
  };
  if (!data.title) { showToast('Título é obrigatório', 'warning'); return; }
  try {
    if (editId) await updateQuest(editId, data);
    else        await createQuest(data);
    closeModal('questModal');
    showToast(editId ? 'Quest atualizada!' : 'Quest criada!', 'success');
    await loadQuests();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.toggleQuest = async function(id, active) {
  try { await toggleQuestActive(id, active); showToast(active ? 'Quest ativada!' : 'Quest desativada!', 'success'); await loadQuests(); }
  catch (err) { showToast(err.message, 'error'); }
};

window.deleteQuestConfirm = async function(id) {
  if (!confirm('Deletar esta quest? Esta ação é irreversível.')) return;
  try { await deleteQuest(id); showToast('Quest deletada!', 'info'); await loadQuests(); }
  catch (err) { showToast(err.message, 'error'); }
};

// ── MAPS ──────────────────────────────────────────────────────
async function loadMaps() {
  const list = document.getElementById('mapsList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const maps = await getAllMaps();
    if (!maps.length) { list.innerHTML = '<div class="empty-state"><i class="fas fa-map"></i><h3>Nenhum mapa criado</h3></div>'; return; }
    list.innerHTML = maps.map(m => `
      <div class="admin-item">
        <span style="font-size:1.5rem">${m.icon_url || '🗺️'}</span>
        <div style="flex:1">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${m.title}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">${m.type||''} · +${m.reward_coins||0} moedas · +${m.reward_xp||0} XP · ❤️ ${m.likes_count||0}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm" onclick="openMapModal('${m.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-delete btn-sm" onclick="deleteMapConfirm('${m.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`; }
}

window.openMapModal = async function(mapId) {
  document.getElementById('mapTitle').value = '';
  document.getElementById('mapDescription').value = '';
  document.getElementById('mapType').value = 'adventure';
  document.getElementById('mapCoins').value = 0;
  document.getElementById('mapXp').value = 0;
  document.getElementById('mapTokens').value = 0;
  document.getElementById('mapDownload').value = '';
  document.getElementById('mapIcon').value = '';
  document.getElementById('mapImageRequired').checked = false;
  document.getElementById('mapEditId').value = '';
  document.getElementById('mapModalTitle').innerHTML = '<i class="fas fa-map"></i> Novo Mapa';

  if (mapId) {
    try {
      const maps = await getAllMaps();
      const m = maps.find(x => x.id === mapId);
      if (m) {
        document.getElementById('mapEditId').value = m.id;
        document.getElementById('mapTitle').value = m.title;
        document.getElementById('mapDescription').value = m.description || '';
        document.getElementById('mapType').value = m.type || 'adventure';
        document.getElementById('mapCoins').value = m.reward_coins || 0;
        document.getElementById('mapXp').value = m.reward_xp || 0;
        document.getElementById('mapTokens').value = m.reward_tokens || 0;
        document.getElementById('mapDownload').value = m.download_url || '';
        document.getElementById('mapIcon').value = m.icon_url || '';
        document.getElementById('mapImageRequired').checked = m.image_required;
        document.getElementById('mapModalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Mapa';
      }
    } catch (e) {}
  }
  openModal('mapModal');
};

window.saveMap = async function() {
  const editId = document.getElementById('mapEditId').value;
  const data = {
    title:          document.getElementById('mapTitle').value.trim(),
    description:    document.getElementById('mapDescription').value.trim(),
    type:           document.getElementById('mapType').value,
    reward_coins:   parseInt(document.getElementById('mapCoins').value) || 0,
    reward_xp:      parseInt(document.getElementById('mapXp').value) || 0,
    reward_tokens:  parseInt(document.getElementById('mapTokens').value) || 0,
    download_url:   document.getElementById('mapDownload').value.trim() || null,
    icon_url:       document.getElementById('mapIcon').value.trim() || null,
    image_required: document.getElementById('mapImageRequired').checked
  };
  if (!data.title) { showToast('Título é obrigatório', 'warning'); return; }
  try {
    if (editId) await updateMap(editId, data);
    else        await createMap(data);
    closeModal('mapModal');
    showToast(editId ? 'Mapa atualizado!' : 'Mapa criado!', 'success');
    await loadMaps();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteMapConfirm = async function(id) {
  if (!confirm('Deletar este mapa?')) return;
  try { await deleteMap(id); showToast('Mapa deletado!', 'info'); await loadMaps(); }
  catch (err) { showToast(err.message, 'error'); }
};

// ── ACHIEVEMENTS ──────────────────────────────────────────────
async function loadAchievements() {
  const list = document.getElementById('achievementsList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const achs = await getAllAchievements();
    if (!achs.length) { list.innerHTML = '<div class="empty-state"><i class="fas fa-medal"></i><h3>Nenhuma conquista criada</h3></div>'; return; }
    list.innerHTML = achs.map(a => `
      <div class="admin-item">
        <span style="font-size:1.5rem">${a.icon_url || '🏅'}</span>
        <div style="flex:1">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${a.title}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">${a.description||''} · ${a.quests_required||0} quests · Nv${a.level_required||0}+</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm" onclick="openAchievementModal('${a.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-delete btn-sm" onclick="deleteAchievementConfirm('${a.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`; }
}

window.openAchievementModal = async function(achId) {
  ['achTitle','achDescription','achIcon','achCategory','achLevel','achQuests','achCoins','achXp','achTokens','achEditId'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id.includes('Level')||id.includes('Quests')||id.includes('Coins')||id.includes('Xp')||id.includes('Tokens') ? '0' : '';
  });
  document.getElementById('achievementModalTitle').innerHTML = '<i class="fas fa-medal"></i> Nova Conquista';

  if (achId) {
    try {
      const achs = await getAllAchievements();
      const a = achs.find(x => x.id === achId);
      if (a) {
        document.getElementById('achEditId').value = a.id;
        document.getElementById('achTitle').value = a.title;
        document.getElementById('achDescription').value = a.description || '';
        document.getElementById('achIcon').value = a.icon_url || '';
        document.getElementById('achCategory').value = a.category || '';
        document.getElementById('achLevel').value = a.level_required || 0;
        document.getElementById('achQuests').value = a.quests_required || 0;
        document.getElementById('achCoins').value = a.reward_coins || 0;
        document.getElementById('achXp').value = a.reward_xp || 0;
        document.getElementById('achTokens').value = a.reward_tokens || 0;
        document.getElementById('achievementModalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Conquista';
      }
    } catch (e) {}
  }
  openModal('achievementModal');
};

window.saveAchievement = async function() {
  const editId = document.getElementById('achEditId').value;
  const data = {
    title:           document.getElementById('achTitle').value.trim(),
    description:     document.getElementById('achDescription').value.trim(),
    icon_url:        document.getElementById('achIcon').value.trim() || null,
    category:        document.getElementById('achCategory').value.trim() || null,
    level_required:  parseInt(document.getElementById('achLevel').value) || 0,
    quests_required: parseInt(document.getElementById('achQuests').value) || 0,
    reward_coins:    parseInt(document.getElementById('achCoins').value) || 0,
    reward_xp:       parseInt(document.getElementById('achXp').value) || 0,
    reward_tokens:   parseInt(document.getElementById('achTokens').value) || 0
  };
  if (!data.title) { showToast('Título é obrigatório', 'warning'); return; }
  try {
    if (editId) await updateAchievement(editId, data);
    else        await createAchievement(data);
    closeModal('achievementModal');
    showToast(editId ? 'Conquista atualizada!' : 'Conquista criada!', 'success');
    await loadAchievements();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteAchievementConfirm = async function(id) {
  if (!confirm('Deletar esta conquista?')) return;
  try { await deleteAchievement(id); showToast('Conquista deletada!', 'info'); await loadAchievements(); }
  catch (err) { showToast(err.message, 'error'); }
};

// ── USERS ─────────────────────────────────────────────────────
async function loadUsers() {
  const list = document.getElementById('usersList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const users = await getAllUsers();
    list.innerHTML = users.map(u => `
      <div class="admin-item">
        <div class="user-avatar" style="width:38px;height:38px;border-radius:50%;background:var(--gold-dark);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--bg-primary);flex-shrink:0">${(u.nickname||'?')[0].toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${u.nickname} <span style="font-size:.7rem;color:${u.role==='admin'?'var(--purple-light)':'var(--text-muted)'}">[${u.role}]</span></div>
          <div style="font-size:.75rem;color:var(--text-secondary)">${u.email} · Nv${u.level} · ${(u.coins||0).toLocaleString('pt-BR')} moedas</div>
        </div>
        <div class="admin-item-actions">
          ${u.role !== 'admin'
            ? `<button class="btn-edit btn-sm" onclick="makeAdmin('${u.id}','${u.nickname}')">Tornar Admin</button>`
            : `<button class="btn-danger btn-sm" onclick="removeAdmin('${u.id}','${u.nickname}')">Remover Admin</button>`}
        </div>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`; }
}

window.makeAdmin = async function(id, name) {
  if (!confirm(`Tornar ${name} admin?`)) return;
  try { await setUserRole(id, 'admin'); showToast(`${name} agora é admin!`, 'success'); await loadUsers(); }
  catch (err) { showToast(err.message, 'error'); }
};

window.removeAdmin = async function(id, name) {
  if (!confirm(`Remover admin de ${name}?`)) return;
  try { await setUserRole(id, 'user'); showToast(`Admin removido de ${name}`, 'info'); await loadUsers(); }
  catch (err) { showToast(err.message, 'error'); }
};

// ── RESETS ────────────────────────────────────────────────────
function setupResetButtons() {
  document.getElementById('resetDailyBtn')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Resetar ranking DIÁRIO? O histórico será salvo antes.')) return;
    try { await resetDailyRanking(); showToast('Ranking diário resetado!', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('resetWeeklyBtn')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Resetar ranking SEMANAL?')) return;
    try { await resetWeeklyRanking(); showToast('Ranking semanal resetado!', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  });
  document.getElementById('resetMonthlyBtn')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Resetar ranking MENSAL?')) return;
    try { await resetMonthlyRanking(); showToast('Ranking mensal resetado!', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  });
}

// ── MODAL HELPERS ─────────────────────────────────────────────
window.openModal  = (id) => document.getElementById(id)?.classList.add('open');
window.closeModal = (id) => document.getElementById(id)?.classList.remove('open');
function clearForm(ids) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); }
