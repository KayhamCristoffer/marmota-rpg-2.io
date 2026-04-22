// ============================================================
// SESSION MANAGER - Substitui firebase/session-manager.js
// Gestão de sessão com Supabase Auth
// ============================================================
import { sb, getCurrentUser, getUserProfile } from './client.js';
import { ADMIN_UID } from './supabase-config.js';

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos
const WARNING_TIME    = 5  * 60 * 1000; // aviso 5 min antes

let _activityTimer  = null;
let _warningTimer   = null;
let _countdownTimer = null;
let _lastActivity   = Date.now();

// Estado global do usuário atual
export let currentUser    = null;
export let currentProfile = null;

// ── Inicializa sessão ────────────────────────────────────────
export async function initSession(onReady, onLogout) {
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (!session?.user) { onLogout?.(); return; }
      currentUser = session.user;
      try {
        currentProfile = await getUserProfile(session.user.id);
      } catch {
        currentProfile = { id: session.user.id, role: 'user', nickname: session.user.email };
      }
      setupActivityTracking(onLogout);
      onReady?.(currentUser, currentProfile);
    } else if (event === 'SIGNED_OUT') {
      currentUser    = null;
      currentProfile = null;
      clearTimers();
      onLogout?.();
    }
  });

  // Tenta restaurar sessão existente
  const { data: { session } } = await sb.auth.getSession();
  if (!session) onLogout?.();
}

// ── Garante que está logado, senão redireciona ───────────────
export async function requireAuth(adminRequired = false) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }

  currentUser = session.user;
  try {
    currentProfile = await getUserProfile(session.user.id);
  } catch {
    currentProfile = { id: session.user.id, role: 'user' };
  }

  if (adminRequired) {
    const isAdmin = currentProfile?.role === 'admin' || currentUser.id === ADMIN_UID;
    if (!isAdmin) { window.location.href = 'home.html'; return null; }
  }

  setupActivityTracking(() => window.location.href = 'index.html');
  return { user: currentUser, profile: currentProfile };
}

// ── Verifica se é admin ──────────────────────────────────────
export function isAdmin(user = currentUser, profile = currentProfile) {
  return profile?.role === 'admin' || user?.id === ADMIN_UID;
}

// ── Activity tracking ────────────────────────────────────────
function setupActivityTracking(onLogout) {
  const resetActivity = () => {
    _lastActivity = Date.now();
    clearTimers();
    _activityTimer = setTimeout(() => {
      // Mostra aviso
      showSessionWarning(onLogout);
    }, SESSION_TIMEOUT - WARNING_TIME);
  };

  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(evt =>
    window.addEventListener(evt, resetActivity, { passive: true })
  );
  resetActivity();
}

function showSessionWarning(onLogout) {
  const banner = document.getElementById('sessionTimerBanner');
  const text   = document.getElementById('sessionTimerText');
  if (banner) { banner.classList.add('show'); }

  let remaining = Math.floor(WARNING_TIME / 1000);
  const update = () => {
    if (text) {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      text.textContent = `Sessão expira em ${m}:${String(s).padStart(2, '0')}`;
    }
    if (remaining <= 0) {
      clearTimers();
      sb.auth.signOut().then(() => onLogout?.());
    }
    remaining--;
  };
  update();
  _countdownTimer = setInterval(update, 1000);
}

function clearTimers() {
  clearTimeout(_activityTimer);
  clearTimeout(_warningTimer);
  clearInterval(_countdownTimer);
  const banner = document.getElementById('sessionTimerBanner');
  if (banner) banner.classList.remove('show');
}

// ── UI helpers ───────────────────────────────────────────────
export function renderUserInSidebar(profile) {
  if (!profile) return;
  const nickname = document.getElementById('sidebarNickname');
  const role     = document.getElementById('sidebarRole');
  const avatar   = document.getElementById('sidebarAvatar');
  const levelBadge = document.getElementById('sidebarLevelBadge');
  const coins    = document.getElementById('sidebarCoins');
  const xpFill   = document.getElementById('sidebarXpFill');
  const xpLabel  = document.getElementById('sidebarXpLabel');

  if (nickname) nickname.textContent = profile.profile_nickname || profile.nickname || profile.username || 'Aventureiro';
  if (role)     role.textContent     = profile.profile_role || (profile.role === 'admin' ? '⚔ Admin' : '🗡 Marmotinha');
  if (avatar) {
    const icon = profile.icon_url || '';
    const isEmoji = icon.length > 0 && icon.length <= 8 && !icon.startsWith('http');
    if (icon && isEmoji) {
      // Emoji avatar: mostra o emoji como texto
      avatar.style.backgroundImage = '';
      avatar.style.fontSize = '1.4rem';
      avatar.style.display  = 'flex';
      avatar.style.alignItems = 'center';
      avatar.style.justifyContent = 'center';
      avatar.textContent = icon;
    } else if (icon) {
      // URL de imagem
      avatar.textContent = '';
      avatar.style.backgroundImage = `url(${icon})`;
      avatar.style.backgroundSize  = 'cover';
      avatar.style.backgroundPosition = 'center';
    } else {
      avatar.style.backgroundImage = '';
      avatar.textContent = (profile.profile_nickname || profile.nickname || 'A')[0].toUpperCase();
    }
  }
  if (levelBadge) levelBadge.textContent = `${profile.level || 1}`;
  if (coins)      coins.textContent      = (profile.coins || 0).toLocaleString('pt-BR');
  const sidebarTokens = document.getElementById('sidebarTokens');
  if (sidebarTokens) sidebarTokens.textContent = (profile.tokens || 0).toLocaleString('pt-BR');

  // XP bar
  if (xpFill && xpLabel) {
    const { calcLevel, xpForLevel, xpForNextLevel } = window._dbHelpers || {};
    if (calcLevel) {
      const lv       = profile.level || 1;
      const curXp    = profile.xp    || 0;
      const minXp    = xpForLevel(lv);
      const maxXp    = xpForNextLevel(lv);
      const pct      = maxXp > minXp ? Math.min(100, ((curXp - minXp) / (maxXp - minXp)) * 100) : 0;
      xpFill.style.width  = `${pct}%`;
      xpLabel.textContent = `${curXp.toLocaleString('pt-BR')} / ${maxXp.toLocaleString('pt-BR')} XP`;
    }
  }
}

export function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const container = document.querySelector('.toast-container') || (() => {
    const d = document.createElement('div');
    d.className = 'toast-container';
    document.body.appendChild(d);
    return d;
  })();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration + 300);
}
