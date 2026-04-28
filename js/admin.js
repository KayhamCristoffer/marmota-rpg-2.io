// ============================================================
// ADMIN.JS v8 — Toca das Marmotas - Painel Administrativo
// Changelog v8:
//  - Analytics Dashboard: painel com métricas gerais (usuários, quests,
//    submissões, receita, usuários ativos nos últimos 7 dias)
//  - Hall da Fama: visualização dos campeões históricos por período/métrica
//  - Rankings: resetDailyRankingFull/Weekly/Monthly gravam Hall da Fama
//    antes de zerar pontos (fallback client-side da procedure SQL)
//  - Migração v10 corrigida: sem dependência do schema cron
//    (erro "3F000: schema cron does not exist" resolvido)
// ============================================================
import { requireAuth, showToast, renderUserInSidebar } from '../supabase/session-manager.js';
import {
  getPendingSubmissions, approveSubmission, rejectSubmission,
  getAllQuests, createQuest, updateQuest, deleteQuest, toggleQuestActive,
  getAllMaps, createMap, updateMap, deleteMap,
  getAllAchievements, createAchievement, updateAchievement, deleteAchievement,
  getAllUsers, setUserRole,
  getPendingMapSubmissions, approveMapSubmission, rejectMapSubmission,
  resetDailyRanking, resetWeeklyRanking, resetMonthlyRanking,
  resetDailyRankingFull, resetWeeklyRankingFull, resetMonthlyRankingFull,
  getRankingHistory, getRankingResetStatus, getNextResetTimes,
  getHallOfFame, getAdminAnalytics,
  getAllShopItems, createShopItem, updateShopItem, deleteShopItem, getAllPurchases
} from '../supabase/database.js';

// ── Map type icons ─────────────────────────────────────────────
const MAP_ICONS = {
  adventure: '🗺️', pvp: '⚔️', city: '🏙️', dungeon: '🏰',
  lucky: '🍀', event: '🎉', survival: '🌿', parkour: '🏃', custom: '⭐'
};

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
  await loadPanel('analytics');   // Abre no Analytics por padrão
  switchTab('analytics');

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
    analytics:        'Dashboard Analytics',
    submissions:      'Submissões',
    'map-submissions':'Mapas Enviados',
    quests:           'Quests',
    maps:             'Mapas',
    achievements:     'Conquistas',
    users:            'Usuários',
    shop:             'Loja',
    rankings:         'Rankings',
    halloffame:       'Hall da Fama'
  };
  const tt = document.getElementById('topbarTitle');
  if (tt) tt.textContent = `⚙️ ${titles[tab] || tab}`;
}

async function loadPanel(tab) {
  if (tab === 'analytics')        await loadAnalytics();
  if (tab === 'submissions')      await loadSubmissions();
  if (tab === 'map-submissions')  await loadMapSubmissions();
  if (tab === 'quests')           await loadQuests();
  if (tab === 'maps')             await loadMaps();
  if (tab === 'achievements')     await loadAchievements();
  if (tab === 'users')            await loadUsers();
  if (tab === 'shop')             await loadShopItems();
  if (tab === 'rankings')         await loadRankingHistory();
  if (tab === 'halloffame')       await loadHallOfFame();
}

// ── ANALYTICS DASHBOARD ────────────────────────────────────────
async function loadAnalytics() {
  const panel = document.getElementById('panel-analytics');
  if (!panel) return;
  panel.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando analytics…</h3></div>';
  try {
    const a = await getAdminAnalytics();
    if (!a) { panel.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar dados</h3></div>'; return; }
    const pct = a.totalUsers > 0 ? Math.round(a.activeUsers / a.totalUsers * 100) : 0;
    panel.innerHTML = `
      <div class="analytics-grid">
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#60a5fa"><i class="fas fa-users"></i></div>
          <div class="analytics-value">${a.totalUsers.toLocaleString('pt-BR')}</div>
          <div class="analytics-label">Usuários cadastrados</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#34d399"><i class="fas fa-scroll"></i></div>
          <div class="analytics-value">${a.approvedSubs.toLocaleString('pt-BR')}</div>
          <div class="analytics-label">Quests concluídas</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#f59e0b"><i class="fas fa-inbox"></i></div>
          <div class="analytics-value">${a.pendingSubs.toLocaleString('pt-BR')}</div>
          <div class="analytics-label">Submissões pendentes</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#a78bfa"><i class="fas fa-bolt"></i></div>
          <div class="analytics-value">${a.recentSubs.toLocaleString('pt-BR')}</div>
          <div class="analytics-label">Quests (últimos 7 dias)</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#fb7185"><i class="fas fa-user-check"></i></div>
          <div class="analytics-value">${a.activeUsers.toLocaleString('pt-BR')} <small style="font-size:.6em;opacity:.7">(${pct}%)</small></div>
          <div class="analytics-label">Usuários ativos 7d</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#fbbf24"><i class="fas fa-coins"></i></div>
          <div class="analytics-value">${a.revenueCoins.toLocaleString('pt-BR')}</div>
          <div class="analytics-label">Moedas gastas na loja (7d)</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#c084fc"><i class="fas fa-gem"></i></div>
          <div class="analytics-value">${a.revenueTokens.toLocaleString('pt-BR')}</div>
          <div class="analytics-label">Tokens gastos na loja (7d)</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-icon" style="color:#38bdf8"><i class="fas fa-map"></i></div>
          <div class="analytics-value">${a.totalMaps.toLocaleString('pt-BR')}</div>
          <div class="analytics-label">Mapas aprovados</div>
        </div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px;margin-top:20px">
        <h3 style="font-family:var(--font-title);color:var(--gold);margin-bottom:14px;font-size:.95rem">
          <i class="fas fa-crown"></i> Top 5 Jogadores (Moedas Totais)
        </h3>
        <div style="display:flex;flex-direction:column;gap:8px">
        ${(a.topUsers ?? []).map((u, i) => {
          const medals = ['🥇','🥈','🥉','#4','#5'];
          const name = u.profile_nickname || u.nickname || '?';
          const avatar = u.icon_url && u.icon_url.length <= 8 && !u.icon_url.startsWith('http')
            ? `<span style="font-size:1.3rem">${u.icon_url}</span>`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--bg-input);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--gold);font-size:.85rem">${name[0].toUpperCase()}</div>`;
          return `<div style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;background:var(--bg-input)">
            <span style="font-size:1.1rem;width:28px;text-align:center">${medals[i]}</span>
            ${avatar}
            <span style="flex:1;color:var(--text-primary);font-size:.88rem">${name}</span>
            <span style="color:var(--text-muted);font-size:.75rem">Nv.${u.level || 1}</span>
            <span style="color:var(--gold);font-weight:700;font-size:.88rem"><i class="fas fa-coins" style="font-size:.75rem"></i> ${(u.coins||0).toLocaleString('pt-BR')}</span>
          </div>`;
        }).join('')}
        </div>
      </div>`;
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro: ${err.message}</h3></div>`;
  }
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
      let proofHtml = '<span style="color:var(--text-muted);font-size:.8rem">Sem comprovante</span>';
      if (s.proof_url) {
        if (s.proof_url.startsWith('data:image')) {
          proofHtml = `<div style="cursor:pointer" onclick="viewProof('${s.id}')" title="Ver comprovante"><img src="${s.proof_url}" class="proof-img"/></div>`;
        } else {
          proofHtml = `<a class="proof-link-btn" href="${s.proof_url}" target="_blank"><i class="fas fa-external-link-alt"></i> Ver print</a>`;
        }
      }
      return `<div class="submission-item" id="sub-${s.id}">
        <div style="display:flex;flex-direction:column;gap:4px;flex:1">
          <strong style="font-family:var(--font-title);color:var(--text-primary)">${displayName}</strong>
          <span style="font-size:.8rem;color:var(--text-secondary)">Quest: ${s.quests?.title || 'Quest'}</span>
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
    content.innerHTML = `
      <p style="margin-bottom:12px;color:var(--text-secondary);font-size:.85rem">Comprovante externo:</p>
      <a href="${url}" target="_blank" class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:10px 20px">
        <i class="fas fa-external-link-alt"></i> Abrir ${url.includes('prnt.sc') ? 'Lightshot' : 'Print'}
      </a>
      <p style="margin-top:8px;font-size:.75rem;color:var(--text-muted);word-break:break-all">${url}</p>`;
  }
  openModal('proofModal');
};

// ── MAP SUBMISSIONS ────────────────────────────────────────────
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
          <span style="font-size:.8rem;color:var(--text-secondary)">${typeIcon} ${ms.type} · enviado por <strong>${userName}</strong></span>
          <span style="font-size:.75rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ms.description || '—'}</span>
          <span style="font-size:.72rem;color:var(--text-muted)">${fmtDate(ms.submitted_at)}${ms.download_url ? ` · <a href="${ms.download_url}" target="_blank" style="color:var(--gold)">Download</a>` : ''}</span>
        </div>
        <div class="submission-actions">
          <button class="btn-approve" onclick="openApproveMapSubModal('${ms.id}','${ms.title.replace(/'/g,"\\'")}')"><i class="fas fa-check"></i> Aprovar</button>
          <button class="btn-reject" onclick="rejectMapSubConfirm('${ms.id}')"><i class="fas fa-times"></i> Rejeitar</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro: ${err.message}</h3></div>`;
  }
}

window.openApproveMapSubModal = function(mapSubId, title) {
  document.getElementById('approveMapSubId').value  = mapSubId;
  document.getElementById('approveMapCoins').value  = 0;
  document.getElementById('approveMapXp').value     = 0;
  document.getElementById('approveMapTokens').value = 0;
  document.getElementById('approveMapNotes').value  = '';
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
          <div style="font-size:.75rem;color:var(--text-secondary)">${typeLabels[q.type] || q.type} · +${q.reward_coins} moedas · +${q.reward_xp} XP · Nível ${q.min_level}+ · ${q.cooldown_hours || 0}h cd · ${q.proof_required ? '🔗 Comprovante' : '✅ Sem prova'} · ${q.is_active ? '<span style="color:var(--green)">Ativa</span>' : '<span style="color:var(--red)">Inativa</span>'}</div>
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
  document.getElementById('questTitle').value          = '';
  document.getElementById('questDescription').value    = '';
  document.getElementById('questType').value           = 'daily';
  document.getElementById('questMinLevel').value       = 1;
  document.getElementById('questCoins').value          = 0;
  document.getElementById('questXp').value             = 0;
  document.getElementById('questCooldown').value       = 24;
  document.getElementById('questActive').checked       = true;
  document.getElementById('questProofRequired').checked = false;
  document.getElementById('questEditId').value         = '';
  document.getElementById('questIcon').value           = '';
  document.getElementById('questModalTitle').innerHTML = '<i class="fas fa-scroll"></i> Nova Quest';

  if (questId) {
    try {
      const quests = await getAllQuests();
      const q = quests.find(x => x.id === questId);
      if (q) {
        document.getElementById('questEditId').value           = q.id;
        document.getElementById('questTitle').value            = q.title;
        document.getElementById('questDescription').value      = q.description || '';
        document.getElementById('questType').value             = q.type;
        document.getElementById('questMinLevel').value         = q.min_level || 1;
        document.getElementById('questCoins').value            = q.reward_coins || 0;
        document.getElementById('questXp').value               = q.reward_xp || 0;
        document.getElementById('questCooldown').value         = q.cooldown_hours ?? 24;
        document.getElementById('questActive').checked         = q.is_active;
        document.getElementById('questProofRequired').checked  = q.proof_required;
        document.getElementById('questIcon').value             = q.icon_url || '';
        document.getElementById('questModalTitle').innerHTML   = '<i class="fas fa-edit"></i> Editar Quest';
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
    proof_required: document.getElementById('questProofRequired').checked,
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
  if (!confirm('Deletar esta quest?')) return;
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
  document.getElementById('mapType').value   = 'adventure';
  document.getElementById('mapCoins').value  = 0;
  document.getElementById('mapXp').value     = 0;
  document.getElementById('mapTokens').value = 0;
  document.getElementById('mapModalTitle').innerHTML = '<i class="fas fa-map"></i> Novo Mapa';
  updateMapIconPreview('adventure');

  if (mapId) {
    try {
      const maps = await getAllMaps();
      const m = maps.find(x => x.id === mapId);
      if (m) {
        document.getElementById('mapEditId').value      = m.id;
        document.getElementById('mapTitle').value       = m.title;
        document.getElementById('mapDescription').value = m.description || '';
        document.getElementById('mapType').value        = m.type || 'adventure';
        document.getElementById('mapCoins').value       = m.reward_coins  || 0;
        document.getElementById('mapXp').value          = m.reward_xp     || 0;
        document.getElementById('mapTokens').value      = m.reward_tokens || 0;
        document.getElementById('mapDownload').value    = m.download_url  || '';
        document.getElementById('mapImageUrl').value    = m.image_url     || '';
        document.getElementById('mapCustomIcon').value  = m.icon_url && !MAP_ICONS[m.type] ? m.icon_url : '';
        document.getElementById('mapModalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Mapa';
        updateMapIconPreview(m.type || 'adventure', m.icon_url);
      }
    } catch (e) {}
  }
  openModal('mapModal');
};
window.openMapModal = window.openMapAdminModal;

function updateMapIconPreview(type, customIcon) {
  const preview = document.getElementById('mapIconPreview');
  if (!preview) return;
  preview.textContent = customIcon || MAP_ICONS[type] || '🗺️';
}

window.saveMap = async function() {
  const editId    = document.getElementById('mapEditId').value;
  const mapType   = document.getElementById('mapType').value;
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
    const catLabels = { quest:'⚔️ Quests', map:'🗺️ Mapas', event:'🎉 Evento' };
    list.innerHTML = achs.map(a => `
      <div class="admin-item">
        <span style="font-size:1.5rem">${a.icon_url || '🏅'}</span>
        <div style="flex:1">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${a.title}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">${catLabels[a.category_type] || a.category_type || '?'} · ${a.quests_required || 0} quests · ${a.maps_required || 0} mapas · Nível ${a.level_required || 0}+${a.one_time_redeem ? ' · 🔒 Único' : ''}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm"   onclick="openAchievementModal('${a.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-delete btn-sm" onclick="deleteAchievementConfirm('${a.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`; }
}

window.openAchievementModal = async function(achId) {
  ['achTitle', 'achDescription', 'achIcon', 'achCategory', 'achEditId', 'achEventStart', 'achEventEnd'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['achLevel', 'achQuests', 'achMaps', 'achCoins', 'achXp', 'achTokens'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '0';
  });
  const ctEl = document.getElementById('achCategoryType');
  if (ctEl) ctEl.value = 'quest';
  const otEl = document.getElementById('achOneTime');
  if (otEl) otEl.checked = false;
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
        document.getElementById('achMaps').value        = a.maps_required   || 0;
        document.getElementById('achCoins').value       = a.reward_coins    || 0;
        document.getElementById('achXp').value          = a.reward_xp       || 0;
        document.getElementById('achTokens').value      = a.reward_tokens   || 0;
        if (ctEl) ctEl.value = a.category_type || 'quest';
        if (otEl) otEl.checked = !!a.one_time_redeem;
        const esEl = document.getElementById('achEventStart');
        const eeEl = document.getElementById('achEventEnd');
        if (esEl && a.event_start) esEl.value = a.event_start.substring(0, 16);
        if (eeEl && a.event_end)   eeEl.value = a.event_end.substring(0, 16);
        document.getElementById('achievementModalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Conquista';
      }
    } catch (e) {}
  }
  openModal('achievementModal');
};

window.saveAchievement = async function() {
  const editId = document.getElementById('achEditId').value;
  const esEl = document.getElementById('achEventStart');
  const eeEl = document.getElementById('achEventEnd');
  const data = {
    title:           document.getElementById('achTitle').value.trim(),
    description:     document.getElementById('achDescription').value.trim(),
    icon_url:        document.getElementById('achIcon').value.trim() || null,
    category:        document.getElementById('achCategory').value.trim() || null,
    category_type:   document.getElementById('achCategoryType')?.value || 'quest',
    level_required:  parseInt(document.getElementById('achLevel').value)   || 0,
    quests_required: parseInt(document.getElementById('achQuests').value)  || 0,
    maps_required:   parseInt(document.getElementById('achMaps').value)    || 0,
    reward_coins:    parseInt(document.getElementById('achCoins').value)   || 0,
    reward_xp:       parseInt(document.getElementById('achXp').value)      || 0,
    reward_tokens:   parseInt(document.getElementById('achTokens').value)  || 0,
    one_time_redeem: document.getElementById('achOneTime')?.checked || false,
    event_start:     (esEl?.value) ? new Date(esEl.value).toISOString() : null,
    event_end:       (eeEl?.value) ? new Date(eeEl.value).toISOString() : null
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
      const isEmojiIcon = u.icon_url && u.icon_url.length <= 8 && !u.icon_url.startsWith('http');
      return `<div class="admin-item" id="user-row-${u.id}">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--gold-dark);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--bg-primary);flex-shrink:0;font-size:${isEmojiIcon ? '1.3rem' : '.95rem'}">
          ${isEmojiIcon
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

// ── SHOP ADMIN ────────────────────────────────────────────────
async function loadShopItems() {
  const list = document.getElementById('shopAdminList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const items = await getAllShopItems();
    if (!items.length) { list.innerHTML = '<div class="empty-state"><i class="fas fa-store"></i><h3>Nenhum item criado</h3></div>'; return; }
    const currLabels = { coins:'🪙 Moedas', tokens:'💎 Tokens', both:'🪙+💎 Ambos' };
    list.innerHTML = items.map(item => `
      <div class="admin-item">
        <span style="font-size:1.5rem">${item.icon_url || '🛒'}</span>
        <div style="flex:1">
          <div style="font-family:var(--font-title);color:var(--text-primary)">${item.name} ${item.is_active ? '' : '<span style="color:var(--red);font-size:.7rem">[Inativo]</span>'}</div>
          <div style="font-size:.75rem;color:var(--text-secondary)">${currLabels[item.currency] || item.currency} · ${item.price_coins ? `${item.price_coins} moedas` : ''} ${item.price_tokens ? `${item.price_tokens} tokens` : ''} · Estoque: ${item.stock === -1 ? '∞' : item.stock}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit btn-sm"   onclick="openShopItemModal('${item.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-delete btn-sm" onclick="deleteShopItemConfirm('${item.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  } catch (err) { list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`; }
}

window.openShopItemModal = async function(itemId) {
  ['shopItemName', 'shopItemDescription', 'shopItemIcon', 'shopItemImage',
   'shopItemCategory', 'shopItemEditId'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('shopItemPriceCoins').value  = 0;
  document.getElementById('shopItemPriceTokens').value = 0;
  document.getElementById('shopItemStock').value       = -1;
  document.getElementById('shopItemCurrency').value    = 'coins';
  document.getElementById('shopItemActive').checked    = true;
  document.getElementById('shopItemModalTitle').innerHTML = '<i class="fas fa-store"></i> Novo Item';

  if (itemId) {
    try {
      const items = await getAllShopItems();
      const item = items.find(x => x.id === itemId);
      if (item) {
        document.getElementById('shopItemEditId').value        = item.id;
        document.getElementById('shopItemName').value          = item.name;
        document.getElementById('shopItemDescription').value   = item.description || '';
        document.getElementById('shopItemIcon').value          = item.icon_url    || '';
        document.getElementById('shopItemImage').value         = item.image_url   || '';
        document.getElementById('shopItemCategory').value      = item.category    || '';
        document.getElementById('shopItemPriceCoins').value    = item.price_coins  || 0;
        document.getElementById('shopItemPriceTokens').value   = item.price_tokens || 0;
        document.getElementById('shopItemStock').value         = item.stock ?? -1;
        document.getElementById('shopItemCurrency').value      = item.currency    || 'coins';
        document.getElementById('shopItemActive').checked      = item.is_active;
        document.getElementById('shopItemModalTitle').innerHTML = '<i class="fas fa-edit"></i> Editar Item';
      }
    } catch (e) {}
  }
  openModal('shopItemModal');
};

window.saveShopItem = async function() {
  const editId = document.getElementById('shopItemEditId').value;
  const data = {
    name:          document.getElementById('shopItemName').value.trim(),
    description:   document.getElementById('shopItemDescription').value.trim() || null,
    icon_url:      document.getElementById('shopItemIcon').value.trim()  || null,
    image_url:     document.getElementById('shopItemImage').value.trim() || null,
    category:      document.getElementById('shopItemCategory').value.trim() || 'geral',
    price_coins:   parseInt(document.getElementById('shopItemPriceCoins').value)  || 0,
    price_tokens:  parseInt(document.getElementById('shopItemPriceTokens').value) || 0,
    stock:         parseInt(document.getElementById('shopItemStock').value) ?? -1,
    currency:      document.getElementById('shopItemCurrency').value || 'coins',
    is_active:     document.getElementById('shopItemActive').checked
  };
  if (!data.name) { showToast('Nome é obrigatório', 'warning'); return; }
  try {
    if (editId) await updateShopItem(editId, data);
    else        await createShopItem(data);
    closeModal('shopItemModal');
    showToast(editId ? 'Item atualizado!' : 'Item criado!', 'success');
    await loadShopItems();
  } catch (err) { showToast(err.message, 'error'); }
};

window.deleteShopItemConfirm = async function(id) {
  if (!confirm('Deletar este item?')) return;
  try { await deleteShopItem(id); showToast('Item deletado!', 'info'); await loadShopItems(); }
  catch (err) { showToast(err.message, 'error'); }
};

// ── RANKINGS (visualizador histórico) ─────────────────────────
let currentRankingHistoryType   = 'daily';
let currentRankingHistoryMetric = 'coins';

async function loadRankingHistory() {
  const histList = document.getElementById('rankingHistoryList');
  if (!histList) return;
  histList.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando histórico…</h3></div>';

  // Carrega status dos auto-resets em paralelo
  const [history, resetStatus] = await Promise.all([
    getRankingHistory(currentRankingHistoryType, currentRankingHistoryMetric).catch(e => { console.error(e); return []; }),
    getRankingResetStatus().catch(() => ({ daily: null, weekly: null, monthly: null }))
  ]);

  renderAutoResetStatus(resetStatus);
  renderRankingHistory(history);
}

function renderAutoResetStatus(status) {
  const el = document.getElementById('autoResetStatusPanel');
  if (!el) return;

  const nextTimes = getNextResetTimes();
  const fmtBrt = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
      year: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  };

  const types = [
    { key: 'daily',   label: 'Diário',   icon: 'fa-sun',           next: nextTimes.daily },
    { key: 'weekly',  label: 'Semanal',  icon: 'fa-calendar-week', next: nextTimes.weekly },
    { key: 'monthly', label: 'Mensal',   icon: 'fa-calendar-alt',  next: nextTimes.monthly }
  ];

  el.innerHTML = types.map(t => {
    const last = status[t.key];
    const lastText = last
      ? `<span style="color:var(--green,#22c55e)">✓ ${fmtBrt(last.reset_at)} BRT</span> <small style="color:var(--text-muted)">(${last.rows_saved ?? '?'} registros)</small>`
      : `<span style="color:var(--text-muted)">Nunca (execute migração v10 no Supabase)</span>`;
    const nextText = `<span style="color:var(--gold)">${fmtBrt(t.next)}</span>`;
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:.82rem">
      <i class="fas ${t.icon}" style="color:var(--gold);width:16px"></i>
      <strong style="color:var(--text-primary);min-width:60px">${t.label}</strong>
      <span style="color:var(--text-muted);margin-right:4px">Último:</span>${lastText}
      <span style="color:var(--text-muted);margin-left:8px">Próximo:</span>${nextText}
    </div>`;
  }).join('');
}

function renderRankingHistory(history) {
  const histList = document.getElementById('rankingHistoryList');
  if (!histList) return;

  if (!history || !history.length) {
    histList.innerHTML = `<div class="empty-state">
      <i class="fas fa-history" style="font-size:2rem;opacity:.3;margin-bottom:8px"></i>
      <h3>Nenhum histórico para este período</h3>
      <p style="font-size:.82rem;color:var(--text-muted);max-width:340px;text-align:center">
        O histórico é salvo automaticamente pelo pg_cron (01:45–01:55 BRT)<br>
        ou clique em <strong>Reset Manual</strong> abaixo para salvar agora.
      </p>
    </div>`;
    return;
  }

  // Agrupa por period_label
  const byPeriod = {};
  for (const row of history) {
    const lbl = row.period_label || 'sem período';
    if (!byPeriod[lbl]) byPeriod[lbl] = [];
    byPeriod[lbl].push(row);
  }
  const metricLabel = currentRankingHistoryMetric === 'tokens' ? 'Tokens' : 'Moedas';
  const scoreField  = currentRankingHistoryMetric === 'tokens' ? 'score_tokens' : 'score_coins';
  const medalIcon   = currentRankingHistoryMetric === 'tokens' ? '💎' : '🪙';

  // Ordena períodos do mais recente ao mais antigo
  const periods = Object.keys(byPeriod).sort((a, b) => b.localeCompare(a));

  let html = '';
  for (const period of periods) {
    const rows = byPeriod[period].sort((a, b) => (b[scoreField] || 0) - (a[scoreField] || 0));
    const medals = ['🥇','🥈','🥉'];
    html += `<div class="rh-period-block">
      <div class="rh-period-title">📅 ${period}</div>
      <div style="display:flex;flex-direction:column;gap:5px">
      ${rows.slice(0, 10).map((row, idx) => {
        const name  = row.users?.profile_nickname || row.users?.nickname || '(usuário removido)';
        const score = (row[scoreField] || 0).toLocaleString('pt-BR');
        const medal = medals[idx] || `#${idx + 1}`;
        return `<div class="rh-row">
          <span class="rh-medal">${medal}</span>
          <span class="rh-name">${name}</span>
          <span class="rh-score">${medalIcon} ${score}</span>
        </div>`;
      }).join('')}
      ${rows.length > 10 ? `<div style="font-size:.75rem;color:var(--text-muted);text-align:center;padding-top:4px">+${rows.length - 10} outros jogadores</div>` : ''}
      </div>
    </div>`;
  }
  histList.innerHTML = html;
}

function setupResetButtons() {
  // Period selector para histórico
  document.querySelectorAll('#panel-rankings .filter-btn[data-rh-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#panel-rankings .filter-btn[data-rh-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRankingHistoryType = btn.dataset.rhType;
      loadRankingHistory();
    });
  });
  document.querySelectorAll('#panel-rankings .filter-btn[data-rh-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#panel-rankings .filter-btn[data-rh-metric]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRankingHistoryMetric = btn.dataset.rhMetric;
      loadRankingHistory();
    });
  });

  document.getElementById('resetDailyBtn')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Resetar ranking DIÁRIO agora?\nO Hall da Fama e histórico serão salvos antes de zerar os pontos.')) return;
    const btn = document.getElementById('resetDailyBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Resetando…';
    try {
      await resetDailyRankingFull();
      showToast('✅ Ranking diário resetado! Hall da Fama e histórico salvos.', 'success');
      await loadRankingHistory();
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sun"></i> Reset Ranking Diário'; }
  });

  document.getElementById('resetWeeklyBtn')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Resetar ranking SEMANAL?\nO Hall da Fama e histórico serão salvos antes de zerar os pontos.')) return;
    const btn = document.getElementById('resetWeeklyBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Resetando…';
    try {
      await resetWeeklyRankingFull();
      showToast('✅ Ranking semanal resetado! Hall da Fama e histórico salvos.', 'success');
      await loadRankingHistory();
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-week"></i> Reset Ranking Semanal'; }
  });

  document.getElementById('resetMonthlyBtn')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Resetar ranking MENSAL?\nO Hall da Fama e histórico serão salvos antes de zerar os pontos.')) return;
    const btn = document.getElementById('resetMonthlyBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Resetando…';
    try {
      await resetMonthlyRankingFull();
      showToast('✅ Ranking mensal resetado! Hall da Fama e histórico salvos.', 'success');
      await loadRankingHistory();
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-alt"></i> Reset Ranking Mensal'; }
  });
}

// ── HALL DA FAMA ───────────────────────────────────────────────
let currentHofType   = 'monthly';
let currentHofMetric = 'coins';

async function loadHallOfFame() {
  const panel = document.getElementById('panel-halloffame');
  if (!panel) return;
  panel.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando Hall da Fama…</h3></div>';
  const data = await getHallOfFame(currentHofType, currentHofMetric, 30).catch(() => []);
  renderHallOfFame(data);
}

function renderHallOfFame(data) {
  const panel = document.getElementById('panel-halloffame');
  if (!panel) return;
  const metricIcon = currentHofMetric === 'tokens' ? '💎' : '🪙';
  const metricLabel = currentHofMetric === 'tokens' ? 'Tokens' : 'Moedas';

  let html = `
    <div class="page-header"><h2 class="page-title"><i class="fas fa-crown"></i> Hall da Fama</h2></div>
    <p style="color:var(--text-secondary);font-size:.83rem;margin-bottom:16px">
      Os campeões de cada período são automaticamente registrados no Hall da Fama durante o reset.
      Requer <code style="background:var(--bg-input);padding:2px 6px;border-radius:4px">migração v11</code>.
    </p>
    <div class="rh-period-selector">
      <button class="filter-btn ${currentHofType==='daily'?'active':''}" onclick="setHofType('daily')"><i class="fas fa-sun"></i> Diário</button>
      <button class="filter-btn ${currentHofType==='weekly'?'active':''}" onclick="setHofType('weekly')"><i class="fas fa-calendar-week"></i> Semanal</button>
      <button class="filter-btn ${currentHofType==='monthly'?'active':''}" onclick="setHofType('monthly')"><i class="fas fa-calendar-alt"></i> Mensal</button>
    </div>
    <div class="rh-period-selector">
      <button class="filter-btn ${currentHofMetric==='coins'?'active':''}" onclick="setHofMetric('coins')"><i class="fas fa-coins"></i> Moedas</button>
      <button class="filter-btn ${currentHofMetric==='tokens'?'active':''}" onclick="setHofMetric('tokens')"><i class="fas fa-gem"></i> Tokens</button>
    </div>`;

  if (!data.length) {
    html += `<div class="empty-state" style="margin-top:20px">
      <i class="fas fa-crown" style="font-size:2rem;opacity:.3"></i>
      <h3>Nenhum campeão registrado ainda</h3>
      <p style="font-size:.82rem;color:var(--text-muted)">
        Os campeões são registrados automaticamente ao resetar rankings.<br>
        Execute a <strong>migração v11</strong> no Supabase e depois reset um ranking.
      </p>
    </div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">`;
    data.forEach((row, idx) => {
      const name = row.users?.profile_nickname || row.users?.nickname || '(removido)';
      const icon = row.users?.icon_url;
      const avatarHtml = icon && icon.length <= 8 && !icon.startsWith('http')
        ? `<span style="font-size:1.6rem">${icon}</span>`
        : `<div class="hof-avatar">${name[0].toUpperCase()}</div>`;
      html += `<div class="hof-row">
        <span class="hof-rank">${idx < 3 ? ['🥇','🥈','🥉'][idx] : `#${idx+1}`}</span>
        ${avatarHtml}
        <div class="hof-info">
          <span class="hof-name">${name}</span>
          <span class="hof-period">${row.period_label || '—'}</span>
        </div>
        <span class="hof-score">${metricIcon} ${(row.score||0).toLocaleString('pt-BR')} ${metricLabel}</span>
        <span class="hof-date">${fmtDate(row.recorded_at)}</span>
      </div>`;
    });
    html += `</div>`;
  }
  panel.innerHTML = html;
}

window.setHofType = function(t) { currentHofType = t; loadHallOfFame(); };
window.setHofMetric = function(m) { currentHofMetric = m; loadHallOfFame(); };

// ── UTILS ─────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

window.openModal  = (id) => document.getElementById(id)?.classList.add('open');
window.closeModal = (id) => document.getElementById(id)?.classList.remove('open');
