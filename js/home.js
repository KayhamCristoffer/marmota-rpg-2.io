// ============================================================
// HOME.JS v9 — Toca das Marmotas - Dashboard com Supabase
// Changelog v9:
//  - Ranking diário/semanal/mensal: período BRT corrigido (sem dia anterior)
//    exibe data[HH:MM] até data[HH:MM] com timezone America/Sao_Paulo
//  - Loading overlay global em TODAS as ações assíncronas
//  - Animação de nível de experiência (XP bar smooth + level-up pulse)
//  - Efeito de receber moedas/tokens após completar quest (float animado)
//  - Like/Unlike com animação de coração pop + remoção ao clicar novamente
//  - checkAndAutoReset: verifica e executa reset automático de rankings
//    na janela de manutenção (01:45–02:10 BRT) quando pg_cron não está ativo
//  - Melhorias gerais de UX: page transitions, hover lifts, skeleton loaders
//  - Contador de level com badge animado na sidebar
//  - Feedback visual em todas as ações do usuário
// ============================================================
import { requireAuth, renderUserInSidebar, showToast, isAdmin } from '../supabase/session-manager.js';
import {
  getUser, getUserSubmissions, getActiveQuests, getAllMaps,
  getUserBadges, getAllAchievements, getRanking, subscribeRanking,
  unsubscribeRanking, createSubmission, submitMapByUser,
  updateUserProfile, isMaintenanceTime,
  calcLevel, xpForLevel, xpForNextLevel, likeMap, hasLikedMap,
  formatCooldown, getRankingPeriodLabel,
  getShopItems, buyShopItem, getUserPurchases,
  getShopFavorites, addShopFavorite, removeShopFavorite,
  incrementMapView, checkAndAutoReset
} from '../supabase/database.js';

// ── Estado ───────────────────────────────────────────────────
let currentProfile   = null;
let currentUser      = null;
let currentFilter    = 'all';
let currentMapFilter = 'all';
let currentPeriod    = 'total';
let currentMetric    = 'coins';
let currentShopTab   = 'items';
let rankingChannel   = null;
let allQuests        = [];
let allMaps          = [];
let mySubmissions    = [];
let shopItems        = [];
let shopFavorites    = new Set();

// Lista de emojis para o picker de avatar
const AVATAR_EMOJIS = [
  '🐾','⚔️','🛡️','🏹','🧙','🧝','🧛','🧟','🦸','🦹',
  '🐉','🦊','🐺','🐻','🦁','🐯','🐮','🐸','🐼','🐨',
  '🌟','⭐','💫','🔥','❄️','⚡','🌊','🍀','🌸','🌺',
  '👑','💎','🏆','🎯','🎮','🎲','🃏','🗡️','🪄','🔮',
  '🏔️','🌋','🌈','🌙','☀️','🌊','🍄','🌿','🌴','🌵',
  '😎','😈','👿','💀','☠️','🤖','👾','🎭','🥷','🧿'
];

// ── Loading Overlay ───────────────────────────────────────────
let _loadingCount = 0;
function showLoading(text = 'Processando…') {
  _loadingCount++;
  const ov = document.getElementById('actionOverlay');
  const tx = document.getElementById('actionOverlayText');
  if (ov) { if (tx) tx.textContent = text; ov.classList.add('show'); }
}
function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    document.getElementById('actionOverlay')?.classList.remove('show');
  }
}

// ── Reward Float Effect ───────────────────────────────────────
function floatReward(x, y, text, type = 'coins') {
  const el = document.createElement('div');
  el.className = `reward-float ${type}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function floatRewardFromEl(triggerEl, coins, tokens, xp) {
  const rect = triggerEl?.getBoundingClientRect?.() ||
    { left: window.innerWidth / 2 - 40, top: window.innerHeight / 2, width: 0 };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + window.scrollY;
  const spread = [0, -22, 22, -12, 12];
  let delay = 0;
  if (coins) {
    spread.slice(0, Math.min(3, Math.ceil(coins / 50) || 1)).forEach((off, i) => {
      setTimeout(() => floatReward(cx - 20 + off, cy - i * 8, i === 0 ? `+${coins} 🪙` : '🪙', 'coins'), delay + i * 60);
    });
    delay += 80;
  }
  if (tokens) {
    setTimeout(() => floatReward(cx + 14, cy - 14, `+${tokens} 💎`, 'tokens'), delay);
    delay += 80;
  }
  if (xp) {
    setTimeout(() => floatReward(cx - 10, cy - 24, `+${xp} ✨ XP`, 'xp'), delay);
  }
}

// ── Skeleton / shimmer loading helper ─────────────────────────
function skeletonCards(containerId, count = 4, type = 'quest') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array.from({ length: count }, () =>
    `<div class="skeleton-card skeleton-${type}"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div><div class="skeleton-line w40"></div></div>`
  ).join('');
}

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
  setupMapFilters();
  setupRankingFilters();
  setupShopTabs();
  setupModals();
  setupProfile();
  setupEmojiPicker();
  setupModalOverlayClose();

  await loadDashboard();

  setTimeout(() => document.getElementById('pageLoader')?.classList.add('hide'), 600);

  // ── Auto-reset de rankings (fallback client-side para quando pg_cron não está ativo)
  // Só executa na janela de manutenção 01:45–02:10 BRT para evitar resets acidentais
  _tryAutoReset();
});

async function _tryAutoReset() {
  try {
    const resetDone = await checkAndAutoReset();
    if (resetDone.length > 0) {
      const typeLabels = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal' };
      const names = resetDone.map(t => typeLabels[t] || t).join(', ');
      console.info(`[Auto-Reset] Rankings resetados automaticamente: ${names}`);
      // Notifica apenas admins
      if (isAdmin(currentUser, currentProfile)) {
        showToast(`🔄 Auto-reset executado: ${names}`, 'info');
      }
    }
  } catch (e) {
    console.warn('[Auto-Reset] Erro:', e.message);
  }
}

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
    showLoading('Saindo…');
    try {
      const { signOut } = await import('../supabase/database.js');
      await signOut();
      window.location.href = 'index.html';
    } finally { hideLoading(); }
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
  const titles = {
    dashboard:'Dashboard', quests:'Quests', 'my-quests':'Minhas Quests',
    maps:'Mapas', ranking:'Ranking', shop:'Loja', profile:'Perfil'
  };
  const topbarTitle = document.getElementById('topbarTitle');
  if (topbarTitle) topbarTitle.textContent = titles[page] || page;

  if (page === 'quests')    loadQuests();
  if (page === 'my-quests') loadMyQuests();
  if (page === 'ranking')   loadRanking();
  if (page === 'maps')      loadMaps();
  if (page === 'shop')      loadShop();
  if (page === 'profile')   loadProfile();

  document.getElementById('sidebar')?.classList.remove('mobile-open');
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const profile   = await getUser(currentUser.id);
    const prevLevel = currentProfile?.level || 1;
    const prevCoins = currentProfile?.coins  || 0;
    currentProfile  = profile;
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

    // XP bar animation suave
    const xpBarEl = document.getElementById('xpFillLarge');
    if (xpBarEl) {
      // Pequeno delay para CSS transition funcionar
      setTimeout(() => {
        xpBarEl.style.width = `${pct}%`;
        if (lv > prevLevel) {
          // Level up! Pulsa badge e barra
          xpBarEl.classList.add('level-up');
          setTimeout(() => xpBarEl.classList.remove('level-up'), 2600);
          const badge = document.getElementById('sidebarLevelBadge');
          if (badge) { badge.classList.add('level-pop'); setTimeout(() => badge.classList.remove('level-pop'), 700); }
          showToast(`🎉 Level Up! Você chegou ao Nível ${lv}!`, 'success');
        }
      }, 300);
    }
    setValue('xpPercent',   `${Math.round(pct)}%`);
    setValue('xpLevelLabel', `Nível ${lv}`);
    setValue('xpHint',       `${xp.toLocaleString('pt-BR')} / ${maxX.toLocaleString('pt-BR')} XP (Nv.${lv} → Nv.${lv+1})`);

    // Sidebar XP bar também anima
    const sxpFill = document.getElementById('sidebarXpFill');
    if (sxpFill) {
      const sp = maxX > minX ? Math.min(100, ((xp - minX) / (maxX - minX)) * 100) : 0;
      setTimeout(() => {
        sxpFill.style.width = `${sp}%`;
        sxpFill.classList.add('xp-pulse');
        setTimeout(() => sxpFill.classList.remove('xp-pulse'), 700);
      }, 400);
    }

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
  if (tc) {
    const newVal = (profile.coins || 0).toLocaleString('pt-BR');
    if (tc.textContent !== newVal) {
      tc.textContent = newVal;
      tc.parentElement?.classList.remove('coin-updated');
      void tc.parentElement?.offsetWidth;
      tc.parentElement?.classList.add('coin-updated');
      setTimeout(() => tc.parentElement?.classList.remove('coin-updated'), 500);
    }
  }
  const tt = document.getElementById('topbarTokens');
  if (tt) tt.textContent = (profile.tokens || 0).toLocaleString('pt-BR');
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

function bumpStatCard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const card = el.closest('.stat-card');
  if (!card) return;
  card.classList.remove('bumping');
  void card.offsetWidth; // reflow
  card.classList.add('bumping');
  setTimeout(() => card.classList.remove('bumping'), 500);
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
  skeletonCards('questsGrid', 6, 'quest');

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

  grid.innerHTML = quests.map((q, qi) => {
    const subList = mySubmissions.filter(s => s.quest_id === q.id);
    const sub     = subList[0];
    const status  = sub?.status;

    let btnClass = '', btnText = '', btnDisabled = '';
    let extraHtml = '';

    if (status === 'approved') {
      const cd = formatCooldown(sub?.cooldown_until);
      if (cd) {
        btnClass = 'taken'; btnText = `⏳ Cooldown: ${cd}`; btnDisabled = 'disabled';
        extraHtml = `<div class="cooldown-badge"><i class="fas fa-clock"></i> Reset em ${cd}</div>`;
      } else if (q.cooldown_hours > 0) {
        btnText = '🔄 Refazer';
      } else {
        btnClass = 'completed'; btnText = '✓ Concluída'; btnDisabled = 'disabled';
      }
    } else if (status === 'pending') {
      btnClass = 'pending'; btnText = '⏳ Em Análise'; btnDisabled = 'disabled';
    } else if (status === 'rejected') {
      btnText = '🔄 Reenviar Comprovante';
    } else {
      if (q.proof_required === false) {
        btnText = '✅ Registrar Conclusão';
      } else {
        btnText = '📋 Enviar Comprovante';
      }
    }

    const levelLock = (currentProfile?.level || 1) < (q.min_level || 1);
    if (levelLock) { btnClass = 'taken'; btnText = `🔒 Nível ${q.min_level} necessário`; btnDisabled = 'disabled'; }

    return `<div class="quest-card" data-type="${q.type}" style="animation-delay:${qi * 0.04}s">
      <span class="quest-type-badge type-${q.type}"><i class="fas ${typeIcons[q.type] || 'fa-scroll'}"></i> ${typeLabels[q.type] || q.type}</span>
      <h3 class="quest-title">${q.icon_url ? q.icon_url + ' ' : ''}${q.title}</h3>
      <p class="quest-description">${q.description || ''}</p>
      <div class="quest-meta">
        <span class="quest-reward"><i class="fas fa-coins"></i> ${q.reward_coins || 0} <span class="xp-reward">+${q.reward_xp || 0} XP</span>${q.reward_tokens ? ` <span style="color:var(--purple-light)">+${q.reward_tokens} 💎</span>` : ''}</span>
        ${q.min_level > 1 ? `<span class="quest-slots"><i class="fas fa-lock"></i> Nível ${q.min_level}+</span>` : ''}
        ${q.cooldown_hours > 0 ? `<span style="font-size:.72rem;color:var(--text-muted)"><i class="fas fa-redo"></i> ${q.cooldown_hours}h cooldown</span>` : ''}
      </div>
      ${extraHtml}
      <button class="btn-take-quest ${btnClass}" ${btnDisabled}
        onclick="openSubmitModal('${q.id}', ${!!q.proof_required})" data-reward-coins="${q.reward_coins||0}" data-reward-tokens="${q.reward_tokens||0}" data-reward-xp="${q.reward_xp||0}">${btnText}</button>
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
      list.innerHTML = '<div class="empty-state"><i class="fas fa-tasks"></i><h3>Nenhuma quest enviada ainda</h3><p>Vá para Quests e registre sua conclusão!</p></div>';
      return;
    }
    const statusLabels = { pending:'Em Análise', approved:'Aprovada', rejected:'Rejeitada' };
    list.innerHTML = subs.map(s => {
      const q = s.quests;
      const submittedAt = s.submitted_at
        ? `<span><i class="fas fa-paper-plane"></i> ${fmtDate(s.submitted_at)}</span>`
        : '';
      const reviewedAt = s.reviewed_at
        ? `<span><i class="fas fa-check"></i> ${fmtDate(s.reviewed_at)}</span>`
        : '';
      const cd = s.status === 'approved' ? formatCooldown(s.cooldown_until) : null;
      const cdHtml = cd ? `<div class="cooldown-badge" style="margin-top:4px"><i class="fas fa-clock"></i> Cooldown: ${cd}</div>` : '';

      return `<div class="my-quest-item">
        <div class="my-quest-icon">${q?.icon_url || '📜'}</div>
        <div class="my-quest-info">
          <div class="my-quest-title">${q?.title || 'Quest'}</div>
          <div class="my-quest-meta">
            <span><i class="fas fa-coins"></i> +${q?.reward_coins || 0}</span>
            <span><i class="fas fa-star"></i> +${q?.reward_xp || 0} XP</span>
            ${q?.reward_tokens ? `<span style="color:var(--purple-light)"><i class="fas fa-gem"></i> +${q.reward_tokens}</span>` : ''}
          </div>
          <div class="my-quest-timestamps">${submittedAt}${reviewedAt}</div>
          ${cdHtml}
        </div>
        <span class="status-badge status-${s.status}">${statusLabels[s.status] || s.status}</span>
        ${s.status === 'rejected' ? `<button class="btn-submit-quest" onclick="openSubmitModal('${s.quest_id}', ${!!q?.proof_required})">Reenviar</button>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar</h3></div>`;
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ── Maps ──────────────────────────────────────────────────────
async function loadMaps() {
  const grid = document.getElementById('mapsGrid');
  if (!grid) return;
  skeletonCards('mapsGrid', 4, 'map');
  try {
    allMaps = await getAllMaps();
    renderMaps();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar mapas</h3></div>`;
  }
}

function renderMaps() {
  const grid = document.getElementById('mapsGrid');
  if (!grid) return;
  const maps = currentMapFilter === 'all' ? allMaps : allMaps.filter(m => m.type === currentMapFilter);
  if (!maps.length) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-map"></i><h3>Nenhum mapa disponível</h3></div>';
    return;
  }
  grid.innerHTML = maps.map(m => {
    const creator = m.users?.profile_nickname || m.users?.nickname || null;
    const liked   = currentUser ? hasLikedMap(currentUser.id, m.id) : false;
    return `
    <div class="map-card" data-type="${m.type || 'all'}">
      <div class="map-image">${
        m.image_url
          ? `<img src="${m.image_url}" alt="${m.title}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-md)" onerror="this.parentElement.textContent='${m.icon_url || '🗺️'}'"/>`
          : `<span style="font-size:2.5rem">${m.icon_url || '🗺️'}</span>`
      }</div>
      <div class="map-body">
        <h3 class="map-title">${m.icon_url ? m.icon_url + ' ' : ''}${m.title}</h3>
        <p class="map-description" style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${m.description || ''}</p>
        ${creator ? `<div class="map-creator-tag"><i class="fas fa-user"></i> ${creator}</div>` : ''}
        <div class="map-meta">
          <span><i class="fas fa-heart" style="color:var(--red)"></i> ${m.likes_count || 0}</span>
          <span><i class="fas fa-eye"></i> ${m.views_count || 0}</span>
          ${m.type ? `<span class="map-type-badge">${m.type}</span>` : ''}
        </div>
        <div class="map-actions">
          ${m.download_url ? `<a class="btn-map-action btn-download" href="${m.download_url}" target="_blank"><i class="fas fa-download"></i> Baixar</a>` : ''}
          <button class="btn-map-action btn-like${liked ? ' liked' : ''}" onclick="likeMapBtn('${m.id}', this)" title="${liked ? 'Remover curtida' : 'Curtir mapa'}"><i class="fas fa-heart"></i> ${m.likes_count || 0}</button>
          <button class="btn-map-action" style="background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.3);color:var(--gold)" onclick="openMapDetail('${m.id}')"><i class="fas fa-info-circle"></i> Mais Detalhes</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function setupMapFilters() {
  document.querySelectorAll('#mapsFilterBar .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mapsFilterBar .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMapFilter = btn.dataset.filter;
      renderMaps();
    });
  });
}

window.openMapDetail = async function(mapId) {
  const m = allMaps.find(x => x.id === mapId);
  if (!m) return;

  try {
    await incrementMapView(mapId);
    m.views_count = (m.views_count || 0) + 1;
  } catch (e) { /* ignore */ }

  const creator = m.users?.profile_nickname || m.users?.nickname || null;
  const liked   = currentUser ? hasLikedMap(currentUser.id, m.id) : false;
  const titleEl = document.getElementById('mapDetailTitle');
  const bodyEl  = document.getElementById('mapDetailBody');
  if (titleEl) titleEl.innerHTML = `<i class="fas fa-map"></i> ${m.title}`;
  if (bodyEl) {
    bodyEl.innerHTML = `
      ${m.image_url ? `<img src="${m.image_url}" class="map-detail-image" alt="${m.title}" onerror="this.style.display='none'"/>` : ''}
      <div class="map-detail-info">
        ${m.description ? `<p style="color:var(--text-secondary);font-size:.9rem;line-height:1.5">${m.description}</p>` : ''}
        ${creator ? `<div class="map-creator-tag"><i class="fas fa-user"></i> Criado por: <strong style="color:var(--text-primary)">${creator}</strong></div>` : ''}
        <div class="map-detail-row">
          <div class="map-detail-stat"><i class="fas fa-heart" style="color:var(--red)"></i> ${m.likes_count || 0} curtidas</div>
          <div class="map-detail-stat"><i class="fas fa-eye"></i> ${m.views_count || 0} visualizações</div>
          ${m.type ? `<div class="map-detail-stat"><i class="fas fa-tag"></i> ${m.type}</div>` : ''}
        </div>
        ${(m.reward_coins || m.reward_xp || m.reward_tokens) ? `
        <div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px">Recompensas ao baixar:</div>
          <div class="map-detail-rewards">
            ${m.reward_coins  ? `<span class="map-detail-reward-badge"><i class="fas fa-coins"></i> ${m.reward_coins} moedas</span>` : ''}
            ${m.reward_xp     ? `<span class="map-detail-reward-badge"><i class="fas fa-star"></i> ${m.reward_xp} XP</span>` : ''}
            ${m.reward_tokens ? `<span class="map-detail-reward-badge"><i class="fas fa-gem"></i> ${m.reward_tokens} tokens</span>` : ''}
          </div>
        </div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          ${m.download_url ? `<a class="btn-primary" href="${m.download_url}" target="_blank" style="text-decoration:none;font-size:.85rem"><i class="fas fa-download"></i> Baixar Mapa</a>` : ''}
          <button class="btn-secondary btn-like${liked ? ' liked' : ''}" style="font-size:.85rem" id="mapDetailLikeBtn" onclick="likeMapBtn('${m.id}', this)">
            <i class="fas fa-heart"></i> ${liked ? 'Descurtir' : 'Curtir'} (${m.likes_count || 0})
          </button>
        </div>
      </div>`;
  }
  openModal('mapDetailModal');
};

// ── Ranking ───────────────────────────────────────────────────
async function loadRanking() {
  const list   = document.getElementById('rankingList');
  const podium = document.getElementById('rankingPodium');
  if (list)   list.innerHTML   = '<div class="empty-state"><i class="fas fa-spinner fa-spin fa-2x" style="opacity:.4"></i></div>';
  if (podium) podium.innerHTML = '';
  try {
    const data = await getRanking(currentPeriod, currentMetric);
    renderRanking(data);
    if (rankingChannel) unsubscribeRanking(rankingChannel);
    rankingChannel = subscribeRanking(currentPeriod, currentMetric, renderRanking);
  } catch (err) {
    if (list) list.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>Erro ao carregar ranking</h3></div>`;
  }
}

function renderRanking(data) {
  const podium  = document.getElementById('rankingPodium');
  const list    = document.getElementById('rankingList');
  const periInf = document.getElementById('rankingPeriodInfo');
  if (!podium || !list) return;

  const metricLabel = document.getElementById('rankingMetricLabel');
  if (metricLabel) metricLabel.textContent = currentMetric === 'tokens' ? '💎 Tokens' : '🪙 Moedas';

  // Exibe período BRT com data[HH:MM] até data[HH:MM]
  if (periInf) {
    if (currentPeriod !== 'total') {
      const label = getRankingPeriodLabel(currentPeriod);
      const periodNames = { daily:'Diário 🌅', weekly:'Semanal 📅', monthly:'Mensal 🗓️' };
      periInf.style.display = 'flex';
      periInf.innerHTML =
        `<i class="fas fa-clock"></i>
         <span>
           <strong>Ranking ${periodNames[currentPeriod]}:</strong>
           <span class="period-range-label">${label}</span>
           <small class="period-tz-note">Horário de Brasília (BRT)</small>
         </span>`;
    } else {
      periInf.style.display = 'none';
    }
  }

  if (!data.length) {
    podium.innerHTML = '';
    list.innerHTML = '<div class="empty-state"><i class="fas fa-trophy"></i><h3>Nenhum dado de ranking para este período</h3><p style="font-size:.82rem">Os pontos são zerados a cada reset. Complete quests para aparecer aqui!</p></div>';
    return;
  }

  const top3   = data.slice(0, 3);
  const orders = [1, 0, 2];
  podium.innerHTML = orders.filter(i => top3[i]).map(i => {
    const u   = top3[i];
    const pos = i + 1;
    const name = u.displayName || u.nickname || '?';
    const avatarHtml = u.icon_url
      ? `<div class="podium-avatar" style="overflow:hidden">${isEmoji(u.icon_url) ? `<span style="font-size:1.8rem">${u.icon_url}</span>` : `<img src="${u.icon_url}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent='${name[0].toUpperCase()}'"/>`}</div>`
      : `<div class="podium-avatar">${name[0].toUpperCase()}</div>`;
    return `<div class="podium-item pos-${pos}">
      ${pos === 1 ? '<div style="font-size:1.4rem;margin-bottom:4px">👑</div>' : ''}
      ${avatarHtml}
      <span class="podium-name">${name}</span>
      <span class="podium-coins"><i class="fas fa-${currentMetric === 'tokens' ? 'gem' : 'coins'}" style="font-size:.75rem"></i> ${u.score.toLocaleString('pt-BR')}</span>
      <div class="podium-stand">${pos}</div>
    </div>`;
  }).join('');

  list.innerHTML = data.slice(3).map((u, idx) => {
    const pos  = idx + 4;
    const isMe = u.id === currentUser?.id;
    const name = u.displayName || u.nickname || '?';
    const avatarContent = u.icon_url
      ? (isEmoji(u.icon_url) ? u.icon_url : `<img src="${u.icon_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='${name[0].toUpperCase()}'"/>`)
      : name[0].toUpperCase();
    return `<div class="ranking-item ${isMe ? 'is-me' : ''}" style="animation-delay:${idx * 0.04}s">
      <span class="rank-position">${pos}</span>
      <div class="ranking-avatar">${avatarContent}</div>
      <span class="ranking-name">${name}${isMe ? ' <span class="me-badge">você</span>' : ''}</span>
      <span class="ranking-level">Nv.${u.level || 1}</span>
      <span class="ranking-coins"><i class="fas fa-${currentMetric === 'tokens' ? 'gem' : 'coins'}" style="font-size:.8rem;margin-right:4px"></i>${u.score.toLocaleString('pt-BR')}</span>
    </div>`;
  }).join('');
}

function isEmoji(str) {
  if (!str) return false;
  return str.length <= 8 && !str.startsWith('http');
}

function setupRankingFilters() {
  document.querySelectorAll('#page-ranking .filter-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-ranking .filter-btn[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      if (rankingChannel) unsubscribeRanking(rankingChannel);
      loadRanking();
    });
  });

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

// ── Shop ──────────────────────────────────────────────────────
function setupShopTabs() {
  document.querySelectorAll('.shop-filter-bar .filter-btn[data-shop-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shop-filter-bar .filter-btn[data-shop-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentShopTab = btn.dataset.shopTab;
      renderShopTab();
    });
  });
}

async function loadShop() {
  setValue('shopCoins',  (currentProfile?.coins  || 0).toLocaleString('pt-BR'));
  setValue('shopTokens', (currentProfile?.tokens || 0).toLocaleString('pt-BR'));
  try {
    [shopItems, shopFavorites] = await Promise.all([
      getShopItems(),
      getShopFavorites(currentUser.id).then(favs => new Set(favs.map(f => f.item_id)))
    ]);
    renderShopTab();
  } catch (err) {
    document.getElementById('shopGrid').innerHTML = `<div class="empty-state"><h3>Erro ao carregar loja: ${err.message}</h3></div>`;
  }
}

function renderShopTab() {
  const tabItems     = document.getElementById('shopTabItems');
  const tabPurchases = document.getElementById('shopTabPurchases');
  const tabFavorites = document.getElementById('shopTabFavorites');
  if (!tabItems) return;

  tabItems.style.display     = currentShopTab === 'items'     ? '' : 'none';
  tabPurchases.style.display = currentShopTab === 'purchases' ? '' : 'none';
  tabFavorites.style.display = currentShopTab === 'favorites' ? '' : 'none';

  if (currentShopTab === 'items')     renderShopItems(shopItems);
  if (currentShopTab === 'purchases') loadPurchases();
  if (currentShopTab === 'favorites') renderShopItems(shopItems.filter(i => shopFavorites.has(i.id)));
}

function renderShopItems(items) {
  const targetId = currentShopTab === 'favorites' ? 'shopFavoritesGrid' : 'shopGrid';
  const grid = document.getElementById(targetId);
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = currentShopTab === 'favorites'
      ? '<div class="empty-state"><i class="fas fa-heart"></i><h3>Nenhum favorito ainda</h3><p>Clique no ❤️ em um item para favoritar</p></div>'
      : '<div class="empty-state"><i class="fas fa-store"></i><h3>Nenhum item disponível</h3></div>';
    return;
  }

  grid.innerHTML = items.map(item => {
    const inStock   = item.stock === -1 || item.stock > 0;
    const stockText = item.stock === -1 ? 'Ilimitado' : item.stock === 0 ? 'Esgotado' : `${item.stock} restantes`;
    const stockClass = item.stock === 0 ? 'out' : item.stock > 0 && item.stock < 5 ? 'low' : '';
    const isFaved   = shopFavorites.has(item.id);

    let priceHtml = '';
    if (item.currency === 'coins' || item.currency === 'both')
      priceHtml += `<span class="shop-price-tag"><i class="fas fa-coins"></i> ${item.price_coins}</span>`;
    if (item.currency === 'tokens' || item.currency === 'both')
      priceHtml += `<span class="shop-price-tag" style="background:rgba(167,139,250,.12);border-color:rgba(167,139,250,.25);color:var(--purple-light)"><i class="fas fa-gem"></i> ${item.price_tokens}</span>`;

    const iconHtml = item.image_url
      ? `<img src="${item.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)" onerror="this.parentElement.textContent='${item.icon_url || '🛒'}'"/>`
      : item.icon_url || '🛒';

    return `<div class="shop-item-card">
      <button class="btn-fav-item ${isFaved ? 'faved' : ''}" onclick="toggleFavorite('${item.id}', this)" title="${isFaved ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">
        <i class="fas fa-heart"></i>
      </button>
      <div class="shop-item-icon">${iconHtml}</div>
      <div class="shop-item-name">${item.name}</div>
      ${item.description ? `<div class="shop-item-desc">${item.description}</div>` : ''}
      <div class="shop-item-price">${priceHtml}</div>
      <div class="shop-item-stock ${stockClass}">${stockText}</div>
      <button class="btn-buy-item" ${!inStock ? 'disabled' : ''} onclick="openBuyModal('${item.id}')">
        <i class="fas fa-shopping-cart"></i> ${inStock ? 'Comprar' : 'Esgotado'}
      </button>
    </div>`;
  }).join('');
}

async function loadPurchases() {
  const list = document.getElementById('shopPurchasesList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const purchases = await getUserPurchases(currentUser.id);
    if (!purchases.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-receipt"></i><h3>Nenhuma compra ainda</h3></div>';
      return;
    }
    list.innerHTML = purchases.map(p => {
      const item = p.shop_items;
      return `<div class="purchase-item">
        <div class="item-icon">${item?.icon_url || '🛒'}</div>
        <div style="flex:1">
          <div class="item-name">${item?.name || 'Item'}</div>
          <div class="item-meta">
            ${p.paid_coins ? `<i class="fas fa-coins"></i> ${p.paid_coins} moedas` : ''}
            ${p.paid_tokens ? `<i class="fas fa-gem"></i> ${p.paid_tokens} tokens` : ''}
            · ${p.qty}x · ${fmtDate(p.purchased_at)}
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><h3>Erro: ${err.message}</h3></div>`;
  }
}

window.toggleFavorite = async function(itemId, btn) {
  const isFaved = shopFavorites.has(itemId);
  try {
    if (isFaved) {
      await removeShopFavorite(currentUser.id, itemId);
      shopFavorites.delete(itemId);
      btn.classList.remove('faved');
    } else {
      await addShopFavorite(currentUser.id, itemId);
      shopFavorites.add(itemId);
      btn.classList.add('faved');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.openBuyModal = function(itemId) {
  const item = shopItems.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('buyItemId').value = itemId;
  const info = document.getElementById('buyItemInfo');
  if (info) {
    const userCoins  = currentProfile?.coins  || 0;
    const userTokens = currentProfile?.tokens || 0;
    let costHtml = '';
    if (item.currency === 'coins'  || item.currency === 'both') costHtml += `<div><i class="fas fa-coins" style="color:var(--gold)"></i> ${item.price_coins} moedas (você tem: ${userCoins.toLocaleString('pt-BR')})</div>`;
    if (item.currency === 'tokens' || item.currency === 'both') costHtml += `<div><i class="fas fa-gem" style="color:var(--purple-light)"></i> ${item.price_tokens} tokens (você tem: ${userTokens.toLocaleString('pt-BR')})</div>`;
    info.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:2rem">${item.icon_url || '🛒'}</div>
        <div>
          <div style="font-family:var(--font-title);color:var(--text-primary)">${item.name}</div>
          ${item.description ? `<div style="font-size:.8rem;color:var(--text-muted)">${item.description}</div>` : ''}
        </div>
      </div>
      <div style="font-size:.85rem;color:var(--text-secondary);display:flex;flex-direction:column;gap:4px">${costHtml}</div>`;
  }
  openModal('buyItemModal');
};

window.confirmBuyItem = async function() {
  const itemId = document.getElementById('buyItemId').value;
  const item   = shopItems.find(i => i.id === itemId);
  if (!item) return;
  const btn = document.getElementById('confirmBuyBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processando…';
  showLoading('Processando compra…');
  try {
    await buyShopItem(currentUser.id, itemId);
    closeModal('buyItemModal');
    showToast(`✅ ${item.name} comprado com sucesso!`, 'success');
    // Float cost deduction
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    if (item.price_coins)  floatReward(cx - 40, cy, `-${item.price_coins} 🪙`, 'coins');
    if (item.price_tokens) floatReward(cx + 10, cy, `-${item.price_tokens} 💎`, 'tokens');
    currentProfile = await getUser(currentUser.id);
    setValue('shopCoins',  (currentProfile.coins  || 0).toLocaleString('pt-BR'));
    setValue('shopTokens', (currentProfile.tokens || 0).toLocaleString('pt-BR'));
    updateTopbar(currentProfile);
    renderUserInSidebar(currentProfile);
    shopItems = await getShopItems();
    renderShopItems(shopItems);
  } catch (err) {
    showToast(err.message || 'Erro ao comprar', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Confirmar';
    hideLoading();
  }
};

// ── Profile ───────────────────────────────────────────────────
async function loadProfile() {
  try {
    const p = await getUser(currentUser.id);
    currentProfile = p;

    setValue('profileEmail', currentUser.email || '');
    setValue('profileLevel', p.level || 1);
    setValue('profileRole',  p.profile_role || (p.role === 'admin' ? 'Admin' : 'Marmotinha'));

    const av = document.getElementById('profileAvatar');
    if (av) {
      const icon = p.icon_url || '';
      if (icon && isEmoji(icon)) {
        av.style.backgroundImage = '';
        av.style.fontSize = '2.2rem';
        av.style.display  = 'flex';
        av.style.alignItems = 'center';
        av.style.justifyContent = 'center';
        av.textContent = icon;
      } else if (icon) {
        av.style.backgroundImage = `url(${icon})`;
        av.style.backgroundSize  = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';
      } else {
        av.style.backgroundImage = '';
        av.textContent = ((p.profile_nickname || p.nickname || 'A')[0]).toUpperCase();
      }
    }

    const enick  = document.getElementById('editNickname');
    const epnick = document.getElementById('editProfileNickname');
    const eu     = document.getElementById('editAvatarUrl');
    const ep     = document.getElementById('emojiPreview');
    if (enick)  enick.value  = p.nickname || '';
    if (epnick) epnick.value = p.profile_nickname || p.nickname || '';
    if (eu)     eu.value     = (p.icon_url && !isEmoji(p.icon_url)) ? p.icon_url : '';
    if (ep && p.icon_url && isEmoji(p.icon_url)) ep.textContent = p.icon_url;
    else if (ep) ep.textContent = '🐾';
  } catch (err) {
    showToast('Erro ao carregar perfil: ' + err.message, 'error');
  }
}

function setupProfile() {
  document.getElementById('saveProfileBtn')?.addEventListener('click', async () => {
    const btn    = document.getElementById('saveProfileBtn');
    const pnick  = document.getElementById('editProfileNickname')?.value?.trim();
    const urlVal = document.getElementById('editAvatarUrl')?.value?.trim();
    const emoji  = document.getElementById('emojiPreview')?.textContent?.trim();

    if (!pnick || pnick.length < 2) {
      showToast('Nome de exibição deve ter pelo menos 2 caracteres', 'warning');
      return;
    }

    const iconUrl = urlVal || (emoji && emoji !== '🐾' ? emoji : null);

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Salvando…';
    showLoading('Salvando perfil…');
    try {
      const updated = await updateUserProfile(currentUser.id, {
        profile_nickname: pnick,
        icon_url: iconUrl || null
      });
      if (updated) currentProfile = { ...currentProfile, ...updated };
      else {
        currentProfile.profile_nickname = pnick;
        currentProfile.icon_url = iconUrl || null;
      }
      renderUserInSidebar(currentProfile);
      await loadProfile();
      showToast('✅ Perfil atualizado com sucesso!', 'success');
    } catch (err) {
      showToast(err.message || 'Erro ao salvar', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-save"></i> Salvar';
      hideLoading();
    }
  });
}

// ── Emoji Picker ──────────────────────────────────────────────
function setupEmojiPicker() {
  const grid    = document.getElementById('emojiGrid');
  const toggle  = document.getElementById('toggleEmojiPicker');
  const preview = document.getElementById('emojiPreview');
  if (!grid || !toggle || !preview) return;

  grid.innerHTML = AVATAR_EMOJIS.map(e =>
    `<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`
  ).join('');

  toggle.addEventListener('click', (ev) => {
    ev.stopPropagation();
    grid.classList.toggle('open');
  });

  grid.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.emoji-btn');
    if (!btn) return;
    const emoji = btn.dataset.emoji;
    preview.textContent = emoji;
    const urlInput = document.getElementById('editAvatarUrl');
    if (urlInput) urlInput.value = '';
    grid.classList.remove('open');
  });

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.emoji-picker-wrap')) grid.classList.remove('open');
  });
}

// ── Modais ─────────────────────────────────────────────────────
function setupModals() {
  document.getElementById('closeSubmitModal')?.addEventListener('click',  () => closeModal('submitQuestModal'));
  document.getElementById('cancelSubmitModal')?.addEventListener('click', () => closeModal('submitQuestModal'));
  document.getElementById('confirmSubmitQuest')?.addEventListener('click', submitQuest);

  document.getElementById('closeMapModal')?.addEventListener('click',  () => closeModal('submitMapModal'));
  document.getElementById('cancelMapModal')?.addEventListener('click', () => closeModal('submitMapModal'));
  document.getElementById('confirmSubmitMap')?.addEventListener('click', submitMap);
}

// Fecha modal ao clicar no overlay (fora do modal-box)
function setupModalOverlayClose() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
}

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
window.closeModal = closeModal;

window.openSubmitModal = function(questId, proofRequired = false) {
  if (isMaintenanceTime()) { showToast('⚠️ Sistema em manutenção (01:45–02:05). Tente em breve!', 'warning'); return; }

  if (!proofRequired) {
    submitQuestDirect(questId);
    return;
  }

  document.getElementById('submitQuestId').value   = questId;
  document.getElementById('questImageRequired').value = 'true';

  const urlInput = document.getElementById('proofUrlInput');
  if (urlInput) urlInput.value = '';

  const desc = document.getElementById('questProofDesc');
  if (desc) desc.textContent = 'Cole o link do screenshot (prnt.sc, imgur…) como comprovante. Será analisado pelo admin.';

  openModal('submitQuestModal');
};

async function submitQuestDirect(questId) {
  const triggerBtn = document.querySelector(`button[onclick*="${questId}"]`);
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>'; }
  showLoading('Registrando conclusão…');
  try {
    await createSubmission(currentUser.id, questId, null);
    const q = allQuests.find(x => x.id === questId);
    if (q) {
      // Float rewards a partir do botão clicado
      floatRewardFromEl(triggerBtn, q.reward_coins, q.reward_tokens, q.reward_xp);
    }
    bumpStatCard('statCoins');
    if (q?.reward_tokens) bumpStatCard('statTokens');
    // Pulsa XP bar brevemente
    const xpFill = document.getElementById('xpFillLarge');
    if (xpFill) { xpFill.classList.add('xp-quest-pulse'); setTimeout(() => xpFill.classList.remove('xp-quest-pulse'), 800); }
    showToast('⚔️ Quest registrada! Aguarde aprovação do admin.', 'success');
    await loadQuests();
    await loadMyQuests();
  } catch (err) {
    showToast(err.message || 'Erro ao registrar', 'error');
    if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.innerHTML = '✅ Registrar Conclusão'; }
  } finally {
    hideLoading();
  }
}

window.openUserMapSubmitModal = function() {
  document.getElementById('mapSubmitTitle').value       = '';
  document.getElementById('mapSubmitDescription').value = '';
  document.getElementById('mapSubmitType').value        = 'adventure';
  document.getElementById('mapSubmitDownload').value    = '';
  document.getElementById('mapSubmitImageUrl').value    = '';
  openModal('submitMapModal');
};

// ── Like Map (toggle: curtir/descurtir) ───────────────────────
window.likeMapBtn = async function(mapId, btn) {
  if (!currentUser) { showToast('Faça login para curtir mapas', 'warning'); return; }

  // Bloqueia double-click durante processamento
  if (btn.disabled) return;
  btn.disabled = true;

  // Feedback visual imediato (otimista)
  const wasLiked = btn.classList.contains('liked');
  btn.classList.toggle('liked', !wasLiked);
  btn.classList.add('like-pop');
  setTimeout(() => btn.classList.remove('like-pop'), 450);

  // Partícula de coração ao curtir
  if (!wasLiked) spawnHearts(btn);

  try {
    const isNowLiked = await likeMap(mapId, currentUser.id);
    const m = allMaps.find(x => x.id === mapId);
    if (m) {
      m.likes_count = Math.max(0, (m.likes_count || 0) + (isNowLiked ? 1 : -1));
    }
    const count = m?.likes_count ?? 0;
    if (btn.id === 'mapDetailLikeBtn') {
      btn.innerHTML = `<i class="fas fa-heart"></i> ${isNowLiked ? 'Descurtir' : 'Curtir'} (${count})`;
    } else {
      btn.innerHTML = `<i class="fas fa-heart"></i> ${count}`;
    }
    btn.classList.toggle('liked', isNowLiked);
    if (isNowLiked) {
      const rect = btn.getBoundingClientRect();
      floatReward(rect.left + rect.width / 2, rect.top + window.scrollY - 10, '❤️', 'coins');
      showToast('❤️ Curtida registrada!', 'success');
    } else {
      showToast('💔 Curtida removida.', 'info');
    }
  } catch (err) {
    // Reverte update otimista em caso de erro
    btn.classList.toggle('liked', wasLiked);
    if (!wasLiked) clearHearts();
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
};

// Spawna corações flutuantes ao curtir
function spawnHearts(btn) {
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + window.scrollY;
  const count = 5;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const h = document.createElement('div');
      h.className = 'heart-particle';
      h.textContent = '❤️';
      h.style.cssText = `left:${cx + (Math.random() - 0.5) * 60}px;top:${cy}px;--dx:${(Math.random() - 0.5) * 80}px;`;
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 900);
    }, i * 60);
  }
}
function clearHearts() {
  document.querySelectorAll('.heart-particle').forEach(h => h.remove());
}

async function submitQuest() {
  const btn     = document.getElementById('confirmSubmitQuest');
  const questId = document.getElementById('submitQuestId')?.value;
  if (!questId) return;

  const proofUrl = document.getElementById('proofUrlInput')?.value?.trim();
  if (!proofUrl) {
    showToast('Cole o link do screenshot antes de enviar', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Enviando…';
  showLoading('Enviando comprovante…');
  try {
    await createSubmission(currentUser.id, questId, proofUrl);
    closeModal('submitQuestModal');
    const q = allQuests.find(x => x.id === questId);
    if (q) floatRewardFromEl(btn, q.reward_coins, q.reward_tokens, q.reward_xp);
    showToast('📋 Comprovante enviado! Aguarde a aprovação do admin.', 'success');
    await loadQuests();
    await loadMyQuests();
  } catch (err) {
    showToast(err.message || 'Erro ao enviar', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
    hideLoading();
  }
}

async function submitMap() {
  const btn   = document.getElementById('confirmSubmitMap');
  const title = document.getElementById('mapSubmitTitle')?.value?.trim();
  if (!title) { showToast('Título do mapa é obrigatório', 'warning'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Enviando…';
  showLoading('Enviando mapa para análise…');
  try {
    await submitMapByUser(currentUser.id, {
      title,
      description:  document.getElementById('mapSubmitDescription')?.value?.trim(),
      type:         document.getElementById('mapSubmitType')?.value || 'adventure',
      download_url: document.getElementById('mapSubmitDownload')?.value?.trim() || null,
      image_url:    document.getElementById('mapSubmitImageUrl')?.value?.trim() || null,
    });
    closeModal('submitMapModal');
    showToast('🗺️ Mapa enviado para análise! O admin irá revisar em breve.', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao enviar mapa', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar para Análise';
    hideLoading();
  }
}
