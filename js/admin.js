// ============================================================
// ADMIN.JS v4 — Painel Administrativo com Supabase
// Changelog v4:
//  - Nova aba: Mapas Enviados (map_submissions pendentes)
//  - Aprovar mapa: define recompensas → cria entry em maps
//  - Rejeitar mapa com notas
//  - Proof modal: detecta se é URL ou base64
//  - Quest: salva cooldown_hours; image_required correto
//  - setUserRole: sempre envia profile_role
// ============================================================
import { requireAuth, showToast, renderUserInSidebar } from '../supabase/session-manager.js';
import {
  getPendingSubmissions, approveSubmission, rejectSubmission,
  getAllQuests, createQuest, updateQuest, deleteQuest, toggleQuestActive,
  getAllMaps, createMap, updateMap, deleteMap,
  getAllAchievements, createAchievement, updateAchievement, deleteAchievement,
  getAllUsers, setUserRole,
  getPendingMapSubmissions, approveMapSubmission, rejectMapSubmission,
  resetDailyRanking, resetWeeklyRanking, resetMonthlyRanking
} from '../supabase/database.js';

// ── Map type icons ─────────────────────────────────────────────
const MAP_ICONS = {
  adventure: '🗺️', pvp: '⚔️', city: '🏙️', dungeon: '🏰',
  lucky: '🍀', event: '🎉', survival: '🌿', parkour: '🏃', custom: '⭐'
};

// ── Role labels ────────────────────────────────────────────────
const ROLE_LABELS = { user: 'Marmotinha', moderator: 'Moderador', admin: 'Admin' };

let currentTab = 'submissions';

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const auth = await requireAuth(true);
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
  const titles = {
    submissions:      'Submissões',
    'map-submissions':'Mapas Enviados',
    quests:           'Quests',
    maps:             'Mapas',
    achievements:     'Conquistas',
    users:            'Usuários',
    rankings:         'Rankings'
  };
  const tt = document.getElementById('topbarTitle');
  if (tt) tt.textContent = `⚙️ ${titles[tab] || tab}`;
}

async function loadPanel(tab) {
  if (tab === 'submissions')      await loadSubmissions();
  if (tab === 'map-submissions')  await loadMapSubmissions();
  if (tab === 'quests')           await loadQuests();
  if (tab === 'maps')             await loadMaps();
  if (tab === 'achievements')     await loadAchievements();
  if (tab === 'users')            await loadUsers();
}

// ── QUEST SUBMISSIONS ─────────────────────────────────────────
async function loadSubmissions() {
  const list = document.getElementById('submissionsList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando…</h3></div>';
  try {
    const subs  = await getPendingSubmissions();
    const badge = document.getElementById('submissionsBadge');
    if (badge) badge.textContent = subs.length;
    if (!subs.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><h3>Nenhuma submissão pendente</h3><p>Tudo em dia!</p></div>';
      return;
    }
    list.innerHTML = subs.map(s => {
      const displayName = s.users?.profile_nickname || s.users?.nickname || 'Usuário';
      // proof_url pode ser URL externa (prnt.sc) ou base64
      let proofHtml = '<span style="color:var(--text-muted);font-size:.8rem">Sem comprovante</span>';
      if (s.proof_url) {
        if (s.proof_url.startsWith('data:image') || s.proof_url.startsWith('http')) {
          proofHtml = `<div style="cursor:pointer" onclick="viewProof('${s.id}')" title="Ver comprovante">
            ${s.proof_url.startsWith('data:image')
              ? `<img src="${s.proof_url}" class="proof-img"/>`
              : `<a class="proof-link-btn" href="${s.proof_url}" target="_blank"><i class="fas fa-external-link-alt"></i> Ver print</a>`
            }
          </div>`;
        } else {
          proofHtml = `<a class="proof-link-btn" href="${s.proof_url}" target="_blank"><i class="fas fa-external-link-alt"></i> Ver print</a>`;
        }
      }
      return `<div class="submission-item" id="sub-${s.id}">
        <div style="display:flex;flex-direction:column;gap:4px;flex:1">
          <strong style="font-family:var(--font-title);color:var(--text-primary)">${displayName}</strong>
          <span style="font-size:.8rem;color:var(--text-secondary)">Quest: ${s.quests?.title || s.quest_id || 'Quest'}</span>
          <span style="font-size:.75rem;color:var(--text-muted)">${fmtDate(s.submitted_at)} · +${s.quests?.reward_coins || 0} moedas / +${s.quests?.reward_xp || 0} XP</span>
        </div>
        ${proofHtml}
        <div class="submission-actions">
          <button class="btn-approve" onclick="handleApprove('${s.id}')"><i class="fas fa-check"></i> Aprovar</button>
          <button class="btn-reject"  onclick="handleReject('${s.id}')"><i class="fas fa-times"></i> Rejeitar</button>
        </div>
      </div>`;
    }).join('');

    window._proofUrls = {};
    subs.forEach(s => { if (s.proof_url) window._proofUrls[s.id] = s.proof_url; });
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
  } catch (err) { showToast(err.message, 'error'); }
};

window.handleReject = async function(subId) {
  if (!confirm('Rejeitar esta submissão?')) return;
  try {
    await rejectSubmission(subId);
    showToast('Submissão rejeitada.', 'info');
    document.getElementById(`sub-${subId}`)?.remove();
  } catch (err) { showToast(err.message, 'error'); }
};

window.viewProof = function(subId) {
  const url = window._proofUrls?.[subId];
  if (!url) return;
  const content = document.getElementById('proofModalContent');
  if (!content) return;
  if (url.startsWith('data:image')) {
    content.innerHTML = `<img src="${url}" alt="Comprovante" style="max-width:100%;max-height:70vh;border-radius:var(--radius-md);border:1px solid var(--border)"/>`;
  } else {
    // URL externa — mostra link + iframe ou redirecionamento
    content.innerHTML = `
      <p style="margin-bottom:12px;color:var(--text-secondary);font-size:.85rem">Comprovante externo:</p>
      <a href="${url}" target="_blank" class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:10px 20px">
        <i class="fas fa-external-link-alt"></i> Abrir ${url.includes('prnt.sc') ? 'Lightshot' : 'Print'}
      </a>
      <p style="margin-top:8px;font-size:.75rem;color:var(--text-muted);word-break:break-all">${url}</p>`;
  }
  openModal('proofModal');
};

// ── MAP SUBMISSIONS (usuário enviou, admin aprova) ────────────
async function loadMapSubmissions() {
  const list = document.getElementById('mapSubmissionsList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando…</h3></div>';
  try {
    const subs  = await getPendingMapSubmissions();
    const badge = document.getElementById('mapSubmissionsBadge');
    if (badge) badge.textContent = subs.length;
    if (!subs.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-map-marked-alt"></i><h3>Nenhum mapa pendente</h3><p>Tudo revisado!</p></div>';
      return;
    }
    list.innerHTML = subs.map(ms => {
      const userName = ms.users?.profile_nickname || ms.users?.nickname || 'Usuário';
      const typeIcon = MAP_ICONS[ms.type] || '🗺️';
      const imgHtml  = ms.image_url
        ? `<img src="${ms.image_url}" class="map-sub-image" alt="capa" onerror="this.style.display='none'" onclick="window.open('${ms.image_url}','_blank')"/>`
        : `<div style="width:80px;height:54px;display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--bg-input);border-radius:var(--radius-sm);border:1px solid var(--border)">${typeIcon}</div>`;

      return `<div class="submission-item" id="mapsub-${ms.id}">
        ${imgHtml}
        <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
          <strong style="font-family:var(--font-title);color:var(--text-primary)">${ms.title}</strong>
          <span style="font-size:.8rem;color:var(--text-secondary)">
            ${typeIcon} ${ms.type} · enviado por <strong>${userName}</strong>
          </span>
          <span style="font-size:.75rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ms.description || '—'}</span>
          <span style="font-size:.72rem;color:var(--text-muted)">${fmtDate(ms.submitted_at)}${ms.download_url ? ` · <a href="${ms.download_url}" target="_blank" style="color:var(--gold)">Download</a>` : ''}</span>
        </div>
        <div class="submission-actions">
          <button class="btn-approve" onclick="openApproveMapSubModal('${ms.id}','${ms.title.replace(/'/g,"\\'")}')">
            <i class="fas fa-check"></i> Aprovar
          </button>
          <button class="btn-reject" onclick="rejectMapSubConfirm('${ms.id}')">
            <i class="fas fa-times"></i> Rejeitar
          </button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro: ${err.message}</h3></div>`;
  }
}

window.openApproveMapSubModal = function(mapSubId, title) {
  document.getElementById('approveMapSubId').value = mapSubId;
  document.getElementById('approveMapCoins').value = 0;
  document.getElementById('approveMapXp').value    = 0;
  document.getElementById('approveMapTokens').value= 0;
  document.getElementById('approveMapNotes').value = '';
  const info = document.getElementById('approveMapSubInfo');
  if (info) info.innerHTML = `<i class="fas fa-map"></i> <strong>${title}</strong> — defina as recompensas abaixo:`;
  openModal('approveMapSubModal');
};

window.confirmApproveMapSub = async function() {
  const id = document.getElementById('approveMapSubId').value;
  if (!id) return;
  const rewards = {
    reward_coins:  parseInt(document.getElementById('approveMapCoins').value)  || 0,
    reward_xp:     parseInt(document.getElementById('approveMapXp').value)     || 0,
    reward_tokens: parseInt(document.getElementById('approveMapTokens').value) || 0
  };
  const notes = document.getElementById('approveMapNotes').value.trim();
  try {
    await approveMapSubmission(id, rewards, notes);
    closeModal('approveMapSubModal');
    showToast('Mapa aprovado e publicado! Recompensas enviadas ao usuário.', 'success');
    document.getElementById(`mapsub-${id}`)?.remove();
    const badge = document.getElementById('mapSubmissionsBadge');
    if (badge) badge.textContent = Math.max(0, parseInt(badge.textContent || 0) - 1);
  } catch (err) { showToast(err.message, 'error'); }
};

window.rejectMapSubConfirm = async function(id) {
  const notes = prompt('Motivo da rejeição (opcional):') ?? '';
  try {
    await rejectMapSubmission(id, notes);
    showToast('Mapa rejeitado.', 'info');
    document.getElementById(`mapsub-${id}`)?.remove();
  } catch (err) { showToast(err.message, 'error'); }
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
          <div style="font-size:.75rem;color:var(--text-secondary)">${typeLabels[q.type] || q.type} · +${q.reward_coins} moedas · +${q.reward_xp} XP · Nível ${q.min_level}+ · ${q.cooldown_hours || 0}h cd · ${q.image_required ? '📷' : '🔗'} · ${q.is_active ? '<span style="color:var(--green)">Ativa</span>' : '<span style="color:var(--red)">Inativa</span>'}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm" onclick="openQuestModal('${q.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-sm" style="background:rgba(249,115,22,.15);border:1px solid rgba(249,115,22,.3);color:var(--orange);border-radius:var(--radius-sm);padding:6px 14px;font-size:.8rem" onclick="toggleQuest('${q.id}',${!q.is_active})">${q.is_active ? 'Desativar' : 'Ativar'}</button>
          <button class="btn-delete btn-sm" onclick="deleteQuestConfirm('${q.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro: ${err.message}</h3></div>`;
  }
}

window.openQuestModal = async function(questId) {
  document.getElementById('questTitle').value        = '';
  document.getElementById('questDescription').value  = '';
  document.getElementById('questType').value         = 'daily';
  document.getElementById('questMinLevel').value     = 1;
  document.getElementById('questCoins').value        = 0;
  document.getElementById('questXp').value           = 0;
  document.getElementById('questCooldown').value     = 24;
  document.getElementById('questActive').checked     = true;
  document.getElementById('questImageRequired').checked = false;
  document.getElementById('questEditId').value       = '';
  document.getElementById('questIcon').value         = '';
  document.getElementById('questModalTitle').innerHTML = '<i class="fas fa-scroll"></i> Nova Quest';

  if (questId) {
    try {
      const quests = await getAllQuests();
      const q = quests.find(x => x.id === questId);
      if (q) {
        document.getElementById('questEditId').value          = q.id;
        document.getElementById('questTitle').value           = q.title;
        document.getElementById('questDescription').value     = q.description || '';
        document.getElementById('questType').value            = q.type;
        document.getElementById('questMinLevel').value        = q.min_level || 1;
        document.getElementById('questCoins').value           = q.reward_coins || 0;
        document.getElementById('questXp').value              = q.reward_xp || 0;
        document.getElementById('questCooldown').value        = q.cooldown_hours ?? 24;
        document.getElementById('questActive').checked        = q.is_active;
        document.getElementById('questImageRequired').checked = q.image_required;
        document.getElementById('questIcon').value            = q.icon_url || '';
        document.getElementById('questModalTitle').innerHTML  = '<i class="fas fa-edit"></i> Editar Quest';
      }
    } catch (e) {}
  }
  openModal('questModal');
};

window.saveQuest = async function() {
  const editId = document.getElementById('questEditId').value;
  const data   = {
    title:          document.getElementById('questTitle').value.trim(),
    description:    document.getElementById('questDescription').value.trim(),
    type:           document.getElementById('questType').value,
    min_level:      parseInt(document.getElementById('questMinLevel').value) || 1,
    reward_coins:   parseInt(document.getElementById('questCoins').value) || 0,
    reward_xp:      parseInt(document.getElementById('questXp').value) || 0,
    cooldown_hours: parseInt(document.getElementById('questCooldown').value) ?? 24,
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
  } catch (err) { showToast(err.message, 'error'); }
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
        <span style="font-size:1.5rem">${MAP_ICONS[m.type] || m.icon_url || '🗺️'}</span>
        <div style="flex:1">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${m.title}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">${m.type || 'adventure'} · +${m.reward_coins || 0} moedas · +${m.reward_xp || 0} XP · +${m.reward_tokens || 0} tokens · ❤️ ${m.likes_count || 0}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm"   onclick="openMapAdminModal('${m.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-delete btn-sm" onclick="deleteMapConfirm('${m.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`; }
}

window.openMapAdminModal = async function(mapId) {
  ['mapTitle', 'mapDescription', 'mapDownload', 'mapImageUrl', 'mapCustomIcon', 'mapEditId'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('mapType').value    = 'adventure';
  document.getElementById('mapCoins').value   = 0;
  document.getElementById('mapXp').value      = 0;
  document.getElementById('mapTokens').value  = 0;
  document.getElementById('mapModalTitle').innerHTML = '<i class="fas fa-map"></i> Novo Mapa';
  updateMapIconPreview('adventure');

  if (mapId) {
    try {
      const maps = await getAllMaps();
      const m = maps.find(x => x.id === mapId);
      if (m) {
        document.getElementById('mapEditId').value        = m.id;
        document.getElementById('mapTitle').value         = m.title;
        document.getElementById('mapDescription').value   = m.description || '';
        document.getElementById('mapType').value          = m.type || 'adventure';
        document.getElementById('mapCoins').value         = m.reward_coins  || 0;
        document.getElementById('mapXp').value            = m.reward_xp     || 0;
        document.getElementById('mapTokens').value        = m.reward_tokens || 0;
        document.getElementById('mapDownload').value      = m.download_url  || '';
        document.getElementById('mapImageUrl').value      = m.image_url     || '';
        document.getElementById('mapCustomIcon').value    = m.icon_url && !MAP_ICONS[m.type] ? m.icon_url : '';
        document.getElementById('mapModalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Mapa';
        updateMapIconPreview(m.type || 'adventure', m.icon_url);
      }
    } catch (e) {}
  }
  openModal('mapModal');
};

window.openMapModal = window.openMapAdminModal; // compat

function updateMapIconPreview(type, customIcon) {
  const preview = document.getElementById('mapIconPreview');
  if (!preview) return;
  preview.textContent = customIcon || MAP_ICONS[type] || '🗺️';
}

window.saveMap = async function() {
  const editId   = document.getElementById('mapEditId').value;
  const mapType  = document.getElementById('mapType').value;
  const customIcon = document.getElementById('mapCustomIcon')?.value?.trim();
  const data = {
    title:         document.getElementById('mapTitle').value.trim(),
    description:   document.getElementById('mapDescription').value.trim(),
    type:          mapType,
    reward_coins:  parseInt(document.getElementById('mapCoins').value)  || 0,
    reward_xp:     parseInt(document.getElementById('mapXp').value)     || 0,
    reward_tokens: parseInt(document.getElementById('mapTokens').value) || 0,
    download_url:  document.getElementById('mapDownload').value.trim()  || null,
    image_url:     document.getElementById('mapImageUrl')?.value?.trim() || null,
    icon_url:      customIcon || MAP_ICONS[mapType] || null,
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

window.onMapTypeChange = function() {
  updateMapIconPreview(document.getElementById('mapType').value, document.getElementById('mapCustomIcon')?.value?.trim());
};
window.onMapCustomIconChange = function() {
  updateMapIconPreview(document.getElementById('mapType').value, document.getElementById('mapCustomIcon')?.value?.trim());
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
          <div style="font-size:.75rem;color:var(--text-secondary)">${a.description || ''} · ${a.quests_required || 0} quests · Nível ${a.level_required || 0}+</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm"   onclick="openAchievementModal('${a.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-delete btn-sm" onclick="deleteAchievementConfirm('${a.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`; }
}

window.openAchievementModal = async function(achId) {
  ['achTitle', 'achDescription', 'achIcon', 'achCategory', 'achEditId'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['achLevel', 'achQuests', 'achCoins', 'achXp', 'achTokens'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '0';
  });
  document.getElementById('achievementModalTitle').innerHTML = '<i class="fas fa-medal"></i> Nova Conquista';

  if (achId) {
    try {
      const achs = await getAllAchievements();
      const a = achs.find(x => x.id === achId);
      if (a) {
        document.getElementById('achEditId').value      = a.id;
        document.getElementById('achTitle').value       = a.title;
        document.getElementById('achDescription').value = a.description || '';
        document.getElementById('achIcon').value        = a.icon_url || '';
        document.getElementById('achCategory').value    = a.category || '';
        document.getElementById('achLevel').value       = a.level_required  || 0;
        document.getElementById('achQuests').value      = a.quests_required || 0;
        document.getElementById('achCoins').value       = a.reward_coins    || 0;
        document.getElementById('achXp').value          = a.reward_xp       || 0;
        document.getElementById('achTokens').value      = a.reward_tokens   || 0;
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
    level_required:  parseInt(document.getElementById('achLevel').value)   || 0,
    quests_required: parseInt(document.getElementById('achQuests').value)  || 0,
    reward_coins:    parseInt(document.getElementById('achCoins').value)   || 0,
    reward_xp:       parseInt(document.getElementById('achXp').value)      || 0,
    reward_tokens:   parseInt(document.getElementById('achTokens').value)  || 0
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
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando usuários…</h3></div>';
  try {
    const users = await getAllUsers();
    if (!users.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><h3>Nenhum usuário encontrado</h3><p>Os usuários aparecem aqui após se cadastrarem.</p></div>';
      return;
    }
    list.innerHTML = users.map(u => {
      const displayName = u.profile_nickname || u.nickname || '?';
      const roleLabel   = u.profile_role || ROLE_LABELS[u.role] || u.role;
      return `<div class="admin-item" id="user-row-${u.id}">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--gold-dark);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--bg-primary);flex-shrink:0;font-size:${u.icon_url && u.icon_url.length <= 4 ? '1.3rem' : '.95rem'}">
          ${u.icon_url && u.icon_url.length <= 4
            ? u.icon_url
            : (u.icon_url
                ? `<img src="${u.icon_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none'">`
                : displayName[0].toUpperCase())
          }
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${displayName}
            <span style="font-size:.7rem;color:${u.role === 'admin' ? 'var(--purple-light)' : 'var(--text-muted)'}">[${roleLabel}]</span>
          </div>
          <div style="font-size:.75rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.email} · Nível ${u.level} · ${(u.coins || 0).toLocaleString('pt-BR')} moedas · ${(u.tokens || 0).toLocaleString('pt-BR')} tokens</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm" onclick="openEditUserModal('${u.id}','${displayName.replace(/'/g,"\\'")}','${u.role}','${(u.profile_role || roleLabel).replace(/'/g,"\\'")}')">
            <i class="fas fa-edit"></i> Editar
          </button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro: ${err.message}</h3></div>`;
  }
}

window.openEditUserModal = function(userId, displayName, role, profileRole) {
  document.getElementById('editUserId').value          = userId;
  document.getElementById('editUserName').textContent  = displayName;
  document.getElementById('editUserRole').value        = role;
  document.getElementById('editUserProfileRole').value = profileRole;
  openModal('editUserModal');
};

window.saveUserEdit = async function() {
  const id          = document.getElementById('editUserId').value;
  const role        = document.getElementById('editUserRole').value;
  const profileRole = document.getElementById('editUserProfileRole').value.trim();
  if (!id) return;
  try {
    await setUserRole(id, role, profileRole || ROLE_LABELS[role] || role);
    showToast('Usuário atualizado!', 'success');
    closeModal('editUserModal');
    await loadUsers();
  } catch (err) { showToast(err.message, 'error'); }
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

// ── UTILS ─────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

window.openModal  = (id) => document.getElementById(id)?.classList.add('open');
window.closeModal = (id) => document.getElementById(id)?.classList.remove('open');
