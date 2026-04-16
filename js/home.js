// ============================================================
// HOME.JS v2 - Dashboard com Supabase
// Fixes: token/coins ranking toggle, profile_nickname, remove Nv prefix,
//        profileRole display, perfil edit expandido
// ============================================================
import { requireAuth, renderUserInSidebar, showToast, isAdmin } from '../supabase/session-manager.js';
import {
  getUser, getUserSubmissions, getActiveQuests, getAllMaps,
  getUserBadges, getAllAchievements, getRanking, subscribeRanking,
  unsubscribeRanking, createSubmission, createMapSubmission,
  updateUserProfile, uploadProofImage, isMaintenanceTime,
  calcLevel, xpForLevel, xpForNextLevel, likeMap
} from '../supabase/database.js';

// ── Estado ───────────────────────────────────────────────────
let currentProfile  = null;
let currentUser     = null;
let currentFilter   = 'all';
let currentPeriod   = 'total';
let currentMetric   = 'coins';   // 'coins' | 'tokens'
let rankingChannel  = null;
let allQuests       = [];
let mySubmissions   = [];

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const auth = await requireAuth();
  if (!auth) return;
  currentUser    = auth.user;
  currentProfile = auth.profile;

  window._dbHelpers = { calcLevel, xpForLevel, xpForNextLevel };

  setupSidebar();
  renderUserInSidebar(currentProfile);
  setupNavigation();
  setupQuestFilters();
  setupRankingFilters();
  setupModals();
  setupProfile();

  await loadDashboard();

  setTimeout(() => document.getElementById('pageLoader')?.classList.add('hide'), 600);
});

// ── Sidebar ───────────────────────────────────────────────────
function setupSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const toggle   = document.getElementById('sidebarToggle');
  const main     = document.getElementById('mainContent');
  const topMenu  = document.getElementById('topbarMenu');
  const adminNav = document.getElementById('navAdmin');

  if (isAdmin(currentUser, currentProfile)) {
    if (adminNav) adminNav.style.display = 'flex';
    const roleEl = document.getElementById('sidebarRole');
    if (roleEl) { roleEl.textContent = '⚔ Admin'; roleEl.classList.add('admin-role'); }
  }

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
    main?.classList.toggle('collapsed');
  });
  topMenu?.addEventListener('click', () => sidebar?.classList.toggle('mobile-open'));

  document.getElementById('navLogout')?.addEventListener('click', async () => {
    const { signOut } = await import('../supabase/database.js');
    await signOut();
    window.location.href = 'index.html';
  });
}

// ── Navigation ────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', quests:'Quests', 'my-quests':'Minhas Quests', maps:'Mapas', ranking:'Ranking', profile:'Perfil' };
  const topbarTitle = document.getElementById('topbarTitle');
  if (topbarTitle) topbarTitle.textContent = titles[page] || page;

  if (page === 'quests')    loadQuests();
  if (page === 'my-quests') loadMyQuests();
  if (page === 'ranking')   loadRanking();
  if (page === 'maps')      loadMaps();
  if (page === 'profile')   loadProfile();

  document.getElementById('sidebar')?.classList.remove('mobile-open');
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const profile  = await getUser(currentUser.id);
    currentProfile = profile;
    renderUserInSidebar(profile);
    updateTopbar(profile);

    setValue('statCoins',  (profile.coins  || 0).toLocaleString('pt-BR'));
    setValue('statXp',     (profile.xp     || 0).toLocaleString('pt-BR'));
    setValue('statLevel',  profile.level   || 1);
    setValue('statTokens', (profile.tokens || 0).toLocaleString('pt-BR'));

    const lv   = profile.level || 1;
    const xp   = profile.xp   || 0;
    const minX = xpForLevel(lv);
    const maxX = xpForNextLevel(lv);
    const pct  = maxX > minX ? Math.min(100, ((xp - minX) / (maxX - minX)) * 100) : 0;
    setStyle('xpFillLarge', 'width', `${pct}%`);
    setValue('xpPercent',   `${Math.round(pct)}%`);
    setValue('xpLevelLabel', `Nível ${lv}`);
    setValue('xpHint',       `${xp.toLocaleString('pt-BR')} / ${maxX.toLocaleString('pt-BR')} XP`);

    setValue('dailyCoins',   (profile.coins_daily   || 0).toLocaleString('pt-BR'));
    setValue('weeklyCoins',  (profile.coins_weekly  || 0).toLocaleString('pt-BR'));
    setValue('monthlyCoins', (profile.coins_monthly || 0).toLocaleString('pt-BR'));

    const subs = await getUserSubmissions(currentUser.id);
    mySubmissions = subs;
    setValue('statQuests', subs.filter(s => s.status === 'approved').length);

    const badges = await getUserBadges(currentUser.id);
    setValue('statBadges', badges.length);
    renderBadges(badges);

  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function updateTopbar(profile) {
  const tc = document.getElementById('topbarCoins');
  if (tc) tc.textContent = (profile.coins || 0).toLocaleString('pt-BR');
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

function renderBadges(badges) {
  const grid = document.getElementById('badgesGrid');
  if (!grid) return;
  if (!badges.length) {
    grid.innerHTML = '<p class="no-badges">Nenhuma conquista ainda. Complete quests para desbloquear!</p>';
    return;
  }
  grid.innerHTML = badges.map(b => {
    const a = b.achievements;
    return `<div class="badge-item-full" title="${a?.description || ''}">
      <span class="badge-icon">${a?.icon_url || '🏅'}</span>
      <div><div class="badge-label">${a?.title || 'Conquista'}</div><div class="badge-req">${a?.description || ''}</div></div>
    </div>`;
  }).join('');
}

// ── Quests ────────────────────────────────────────────────────
async function loadQuests() {
  const grid = document.getElementById('questsGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando…</h3></div>';

  const banner = document.getElementById('maintenanceBanner');
  if (banner) banner.style.display = isMaintenanceTime() ? 'flex' : 'none';

  try {
    allQuests     = await getActiveQuests();
    mySubmissions = await getUserSubmissions(currentUser.id);
    renderQuests();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar quests</h3><p>${err.message}</p></div>`;
  }
}

function renderQuests() {
  const grid = document.getElementById('questsGrid');
  if (!grid) return;
  const quests = currentFilter === 'all' ? allQuests : allQuests.filter(q => q.type === currentFilter);
  if (!quests.length) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-scroll"></i><h3>Nenhuma quest disponível</h3></div>';
    return;
  }
  const typeLabels = { daily:'Diária', weekly:'Semanal', monthly:'Mensal', event:'Evento' };
  const typeIcons  = { daily:'fa-sun', weekly:'fa-calendar-week', monthly:'fa-calendar-alt', event:'fa-star' };

  grid.innerHTML = quests.map(q => {
    const sub  = mySubmissions.find(s => s.quest_id === q.id);
    const status = sub?.status;
    let btnClass = '', btnText = '', btnDisabled = '';
    if (status === 'approved')  { btnClass = 'completed'; btnText = '✓ Concluída';        btnDisabled = 'disabled'; }
    else if (status === 'pending')  { btnClass = 'pending';   btnText = '⏳ Em Análise';  btnDisabled = 'disabled'; }
    else if (status === 'rejected') { btnText = '🔄 Reenviar Comprovante'; }
    else { btnText = '📸 Enviar Comprovante'; }

    const levelLock = (currentProfile?.level || 1) < (q.min_level || 1);
    if (levelLock) { btnClass = 'taken'; btnText = `🔒 Nível ${q.min_level} necessário`; btnDisabled = 'disabled'; }

    return `<div class="quest-card" data-type="${q.type}">
      <span class="quest-type-badge type-${q.type}"><i class="fas ${typeIcons[q.type] || 'fa-scroll'}"></i> ${typeLabels[q.type] || q.type}</span>
      <h3 class="quest-title">${q.icon_url ? q.icon_url + ' ' : ''}${q.title}</h3>
      <p class="quest-description">${q.description || ''}</p>
      <div class="quest-meta">
        <span class="quest-reward"><i class="fas fa-coins"></i> ${q.reward_coins || 0} <span class="xp-reward">+${q.reward_xp || 0} XP</span></span>
        ${q.min_level > 1 ? `<span class="quest-slots"><i class="fas fa-lock"></i> Nível ${q.min_level}+</span>` : ''}
      </div>
      <button class="btn-take-quest ${btnClass}" ${btnDisabled}
        onclick="openSubmitModal('${q.id}')">${btnText}</button>
    </div>`;
  }).join('');
}

function setupQuestFilters() {
  document.querySelectorAll('#page-quests .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-quests .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderQuests();
    });
  });
}

// ── My Quests ─────────────────────────────────────────────────
async function loadMyQuests() {
  const list = document.getElementById('myQuestsList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando…</h3></div>';
  try {
    const subs = await getUserSubmissions(currentUser.id);
    if (!subs.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-tasks"></i><h3>Nenhuma quest enviada ainda</h3><p>Vá para Quests e envie seu comprovante!</p></div>';
      return;
    }
    const statusLabels = { pending:'Em Análise', approved:'Aprovada', rejected:'Rejeitada' };
    list.innerHTML = subs.map(s => {
      const q = s.quests;
      return `<div class="my-quest-item">
        <div class="my-quest-icon">${q?.icon_url || '📜'}</div>
        <div class="my-quest-info">
          <div class="my-quest-title">${q?.title || 'Quest'}</div>
          <div class="my-quest-meta">
            <span><i class="fas fa-coins"></i> +${q?.reward_coins || 0}</span>
            <span><i class="fas fa-star"></i> +${q?.reward_xp || 0} XP</span>
            <span>${new Date(s.submitted_at).toLocaleDateString('pt-BR')}</span>
          </div>
        </div>
        <span class="status-badge status-${s.status}">${statusLabels[s.status] || s.status}</span>
        ${s.status === 'rejected' ? `<button class="btn-submit-quest" onclick="openSubmitModal('${s.quest_id}')">Reenviar</button>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar</h3></div>`;
  }
}

// ── Maps ──────────────────────────────────────────────────────
async function loadMaps() {
  const grid = document.getElementById('mapsGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><h3>Carregando mapas…</h3></div>';
  try {
    const maps = await getAllMaps();
    if (!maps.length) {
      grid.innerHTML = '<div class="empty-state"><i class="fas fa-map"></i><h3>Nenhum mapa disponível</h3></div>';
      return;
    }
    grid.innerHTML = maps.map(m => `
      <div class="map-card" data-type="${m.type || 'all'}">
        <div class="map-image">${
          m.image_url
            ? `<img src="${m.image_url}" alt="${m.title}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-md)" onerror="this.style.display='none'">`
            : (m.icon_url || '🗺️')
        }</div>
        <div class="map-body">
          <h3 class="map-title">${m.icon_url ? m.icon_url + ' ' : ''}${m.title}</h3>
          <p class="map-description">${m.description || ''}</p>
          <div class="map-meta">
            <span><i class="fas fa-heart"></i> ${m.likes_count || 0}</span>
            <span><i class="fas fa-eye"></i> ${m.views_count || 0}</span>
            ${m.type ? `<span class="map-type-badge">${m.type}</span>` : ''}
          </div>
          <div class="map-rewards">
            ${m.reward_coins  ? `<span class="map-reward-badge reward-coins"><i class="fas fa-coins"></i> ${m.reward_coins}</span>` : ''}
            ${m.reward_xp     ? `<span class="map-reward-badge reward-xp"><i class="fas fa-star"></i> ${m.reward_xp} XP</span>` : ''}
            ${m.reward_tokens ? `<span class="map-reward-badge reward-tokens"><i class="fas fa-gem"></i> ${m.reward_tokens} tokens</span>` : ''}
          </div>
          <div class="map-actions">
            ${m.download_url ? `<a class="btn-map-action btn-download" href="${m.download_url}" target="_blank"><i class="fas fa-download"></i> Baixar</a>` : ''}
            <button class="btn-map-action btn-like" onclick="likeMapBtn('${m.id}', this)"><i class="fas fa-heart"></i> ${m.likes_count || 0}</button>
            ${m.image_required ? `<button class="btn-map-action btn-submit-map" onclick="openMapModal('${m.id}')"><i class="fas fa-upload"></i> Enviar</button>` : ''}
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar mapas</h3></div>`;
  }
}

// ── Ranking ───────────────────────────────────────────────────
async function loadRanking() {
  try {
    const data = await getRanking(currentPeriod, currentMetric);
    renderRanking(data);
    if (rankingChannel) unsubscribeRanking(rankingChannel);
    rankingChannel = subscribeRanking(currentPeriod, currentMetric, renderRanking);
  } catch (err) {
    const el = document.getElementById('rankingList');
    if (el) el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar ranking</h3></div>`;
  }
}

function renderRanking(data) {
  const podium = document.getElementById('rankingPodium');
  const list   = document.getElementById('rankingList');
  if (!podium || !list) return;

  // Atualiza label da métrica no topo
  const metricLabel = document.getElementById('rankingMetricLabel');
  if (metricLabel) metricLabel.textContent = currentMetric === 'tokens' ? '💎 Tokens' : '🪙 Moedas';

  if (!data.length) {
    podium.innerHTML = '';
    list.innerHTML = '<div class="empty-state"><i class="fas fa-trophy"></i><h3>Nenhum dado de ranking</h3></div>';
    return;
  }

  const top3   = data.slice(0, 3);
  const orders = [1, 0, 2];
  podium.innerHTML = orders.filter(i => top3[i]).map(i => {
    const u   = top3[i];
    const pos = i + 1;
    const name = u.displayName || u.nickname || '?';
    const avatar = u.icon_url
      ? `<img src="${u.icon_url}" class="podium-avatar" alt="${name}" onerror="this.style.display='none'">`
      : `<div class="podium-avatar">${name[0].toUpperCase()}</div>`;
    return `<div class="podium-item pos-${pos}">
      ${pos === 1 ? '<div style="font-size:1.4rem;margin-bottom:4px">👑</div>' : ''}
      ${avatar}
      <span class="podium-name">${name}</span>
      <span class="podium-coins"><i class="fas fa-${currentMetric === 'tokens' ? 'gem' : 'coins'}" style="font-size:.75rem"></i> ${u.score.toLocaleString('pt-BR')}</span>
      <div class="podium-stand">${pos}</div>
    </div>`;
  }).join('');

  list.innerHTML = data.slice(3).map((u, idx) => {
    const pos  = idx + 4;
    const isMe = u.id === currentUser?.id;
    const name = u.displayName || u.nickname || '?';
    return `<div class="ranking-item ${isMe ? 'is-me' : ''}">
      <span class="rank-position">${pos}</span>
      <div class="ranking-avatar">${u.icon_url ? `<img src="${u.icon_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : name[0].toUpperCase()}</div>
      <span class="ranking-name">${name}${isMe ? ' 👈' : ''}</span>
      <span class="ranking-level">${u.level || 1}</span>
      <span class="ranking-coins"><i class="fas fa-${currentMetric === 'tokens' ? 'gem' : 'coins'}" style="font-size:.8rem;margin-right:4px"></i>${u.score.toLocaleString('pt-BR')}</span>
    </div>`;
  }).join('');
}

function setupRankingFilters() {
  // Filtros de período
  document.querySelectorAll('#page-ranking .filter-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-ranking .filter-btn[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      if (rankingChannel) unsubscribeRanking(rankingChannel);
      loadRanking();
    });
  });

  // Toggle coins/tokens
  document.querySelectorAll('#page-ranking .filter-btn[data-metric]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-ranking .filter-btn[data-metric]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMetric = btn.dataset.metric;
      if (rankingChannel) unsubscribeRanking(rankingChannel);
      loadRanking();
    });
  });
}

// ── Profile ───────────────────────────────────────────────────
async function loadProfile() {
  try {
    const p = await getUser(currentUser.id);
    currentProfile = p;

    // Dados exibidos (somente leitura)
    setValue('profileEmail', currentUser.email || '');
    // Nível sem "Nv" — só o número
    setValue('profileLevel', p.level || 1);
    // Cargo exibido (profile_role)
    setValue('profileRole', p.profile_role || (p.role === 'admin' ? 'Admin' : 'Marmotinha'));

    // Avatar
    const av = document.getElementById('profileAvatar');
    if (av) {
      if (p.icon_url) {
        av.style.backgroundImage = `url(${p.icon_url})`;
        av.style.backgroundSize  = 'cover';
        av.textContent = '';
      } else {
        av.style.backgroundImage = '';
        av.textContent = ((p.profile_nickname || p.nickname || 'A')[0]).toUpperCase();
      }
    }

    // Campos editáveis
    const enick = document.getElementById('editNickname');
    const epnick = document.getElementById('editProfileNickname');
    const eu     = document.getElementById('editAvatarUrl');
    if (enick)  enick.value  = p.nickname         || '';
    if (epnick) epnick.value = p.profile_nickname || p.nickname || '';
    if (eu)     eu.value     = p.icon_url         || '';
  } catch (err) {
    showToast('Erro ao carregar perfil: ' + err.message, 'error');
  }
}

function setupProfile() {
  document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
    const btn     = document.getElementById('saveProfileBtn');
    const pnick   = document.getElementById('editProfileNickname')?.value?.trim();
    const iconUrl = document.getElementById('editAvatarUrl')?.value?.trim();

    if (!pnick || pnick.length < 2) {
      showToast('Nome de exibição deve ter pelo menos 2 caracteres', 'warning');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Salvando…';
    try {
      const updated = await updateUserProfile(currentUser.id, {
        profile_nickname: pnick,
        icon_url:         iconUrl || null
      });
      if (updated) {
        currentProfile = { ...currentProfile, ...updated };
      } else {
        currentProfile.profile_nickname = pnick;
        currentProfile.icon_url = iconUrl || null;
      }
      renderUserInSidebar(currentProfile);
      await loadProfile();
      showToast('Perfil atualizado com sucesso!', 'success');
    } catch (err) {
      showToast(err.message || 'Erro ao salvar', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Salvar';
    }
  });
}

// ── Modais ─────────────────────────────────────────────────────
function setupModals() {
  document.getElementById('closeSubmitModal')?.addEventListener('click',  () => closeModal('submitQuestModal'));
  document.getElementById('cancelSubmitModal')?.addEventListener('click', () => closeModal('submitQuestModal'));
  document.getElementById('proofFile')?.addEventListener('change', e => handleFilePreview(e.target.files[0], 'previewImg', 'uploadPreview', 'confirmSubmitQuest'));
  document.getElementById('confirmSubmitQuest')?.addEventListener('click', submitQuest);

  document.getElementById('closeMapModal')?.addEventListener('click',  () => closeModal('submitMapModal'));
  document.getElementById('cancelMapModal')?.addEventListener('click', () => closeModal('submitMapModal'));
  document.getElementById('mapProofFile')?.addEventListener('change', e => handleFilePreview(e.target.files[0], 'mapPreviewImg', 'mapUploadPreview', 'confirmSubmitMap'));
  document.getElementById('confirmSubmitMap')?.addEventListener('click', submitMap);
}

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

window.openSubmitModal = function(questId) {
  if (isMaintenanceTime()) { showToast('Sistema em manutenção (01:30–02:00). Tente em breve!', 'warning'); return; }
  document.getElementById('submitQuestId').value  = questId;
  document.getElementById('proofFile').value       = '';
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('confirmSubmitQuest').disabled = true;
  openModal('submitQuestModal');
};

window.openMapModal = function(mapId) {
  document.getElementById('submitMapId').value    = mapId;
  document.getElementById('mapProofFile').value   = '';
  document.getElementById('mapUploadPreview').style.display = 'none';
  document.getElementById('confirmSubmitMap').disabled = true;
  openModal('submitMapModal');
};

window.likeMapBtn = async function(mapId) {
  try {
    await likeMap(mapId);
    showToast('Curtida registrada!', 'success');
    await loadMaps();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function handleFilePreview(file, previewImgId, previewWrapId, confirmBtnId) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Imagem muito grande! Máximo: 2MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img  = document.getElementById(previewImgId);
    const wrap = document.getElementById(previewWrapId);
    const btn  = document.getElementById(confirmBtnId);
    if (img)  img.src = e.target.result;
    if (wrap) wrap.style.display = 'block';
    if (btn)  btn.disabled = false;
  };
  reader.readAsDataURL(file);
}

async function submitQuest() {
  const btn     = document.getElementById('confirmSubmitQuest');
  const questId = document.getElementById('submitQuestId')?.value;
  const file    = document.getElementById('proofFile')?.files[0];
  if (!questId || !file) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Enviando…';
  try {
    const proofUrl = await uploadProofImage(file);
    await createSubmission(currentUser.id, questId, proofUrl);
    closeModal('submitQuestModal');
    showToast('Comprovante enviado! Aguarde a aprovação do admin.', 'success');
    await loadQuests();
    await loadMyQuests();
  } catch (err) {
    showToast(err.message || 'Erro ao enviar', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
  }
}

async function submitMap() {
  const btn   = document.getElementById('confirmSubmitMap');
  const mapId = document.getElementById('submitMapId')?.value;
  const file  = document.getElementById('mapProofFile')?.files[0];
  if (!mapId || !file) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Enviando…';
  try {
    const proofUrl = await uploadProofImage(file);
    await createMapSubmission(currentUser.id, mapId, proofUrl);
    closeModal('submitMapModal');
    showToast('Mapa enviado para análise!', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao enviar mapa', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
  }
}
