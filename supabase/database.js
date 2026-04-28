// ================================================================
// SUPABASE DATABASE v11 — Toca das Marmotas
// Changelog v11:
//  - Hall da Fama: getHallOfFame(), registerHallOfFame()
//  - Amizades/Seguidores: sendFriendRequest(), acceptFriendRequest(),
//    removeFriend(), getFriends(), getFriendRequests()
//  - Missões em Grupo: getGroupMissions(), createGroupMission(),
//    joinGroupMission(), leaveGroupMission()
//  - Moderação de Conteúdo: voteContent(), getContentVotes()
//  - Perfil Público: getPublicProfile(), updatePublicProfile()
//  - Analytics Admin: getAdminAnalytics()
//  - Histórico público de ranking: getRankingHistory() melhorado
//  - Auto-reset: checkAndAutoReset() + rankingResetLog com Hall da Fama
// ================================================================
import { sb } from './client.js';
import { ADMIN_UID } from './supabase-config.js';

// ─── CONSTANTS ────────────────────────────────────────────────
export const MAP_TYPE_ICONS = {
  adventure: '🗺️', pvp: '⚔️', city: '🏙️', dungeon: '🏰',
  lucky: '🍀', event: '🎉', survival: '🌿', parkour: '🏃', custom: '⭐'
};

// ─── UTILS internos ───────────────────────────────────────────
function sanitizeNickname(email) {
  return (email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)) || 'user';
}

// Garante que o usuário autenticado tem um row na tabela users.
// Chamado em signIn e em onAuthStateChange para cobrir usuários legados.
export async function ensureProfile(user) {
  if (!user) return;
  try {
    const { data: existing } = await sb
      .from('users').select('id').eq('id', user.id).maybeSingle();
    if (!existing) {
      const nick = sanitizeNickname(user.email || 'user');
      // Tenta inserir. Se outro processo já criou (race condition), ignora.
      const { error } = await sb.from('users').upsert({
        id: user.id,
        email: user.email,
        nickname: nick + '_' + Date.now().toString().slice(-4),
        profile_nickname: nick,
        role: 'user',
        profile_role: 'Marmotinha',
        level: 1, xp: 0, coins: 0, tokens: 0
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) console.warn('ensureProfile upsert:', error.message);
    }
  } catch (e) {
    console.warn('ensureProfile error:', e.message);
  }
}

// ─── AUTH ─────────────────────────────────────────────────────

export async function signUp(email, password, nickname) {
  // Redireciona para o GitHub Pages correto após confirmação de e-mail
  const redirectTo = window.location.hostname.includes('github.io')
    ? 'https://kayhamcristoffer.github.io/marmota-rpg-2.io/index.html'
    : `${window.location.origin}/index.html`;

  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  if (error) throw error;
  const user = data.user;
  if (user) {
    // O trigger handle_new_user() já pode ter criado o row.
    // Upsert com o nickname escolhido pelo usuário na tela de cadastro.
    await sb.from('users').upsert({
      id: user.id, email,
      nickname: nickname,
      profile_nickname: nickname,
      role: 'user', profile_role: 'Marmotinha',
      level: 1, xp: 0, coins: 0, tokens: 0
    }, { onConflict: 'id' }).select();
  }
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // Garante que perfil existe (cobre usuários antigos sem row na tabela)
  if (data.user) await ensureProfile(data.user);
  return data;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email) {
  const redirectTo = window.location.hostname.includes('github.io')
    ? 'https://kayhamcristoffer.github.io/marmota-rpg-2.io/index.html'
    : `${window.location.origin}/index.html`;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
      await ensureProfile(session.user);
    }
    callback(session?.user ?? null, event);
  });
  return subscription;
}

// ─── USERS ────────────────────────────────────────────────────

export async function getUser(userId) {
  const { data, error } = await sb.from('users').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function updateUserProfile(userId, updates) {
  const { data, error } = await sb
    .from('users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getAllUsers() {
  const { data, error } = await sb
    .from('users').select('*').order('coins', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Admin: atualiza role e profile_role
// A RLS u_upd permite: auth.uid() = id OR is_admin()
// is_admin() faz SELECT na tabela users — isso funciona com SECURITY DEFINER.
export async function setUserRole(userId, role, profileRole) {
  const updates = { role };
  if (profileRole !== undefined) updates.profile_role = profileRole;
  return updateUserProfile(userId, updates);
}

// ─── QUESTS ───────────────────────────────────────────────────

export async function getAllQuests() {
  const { data, error } = await sb
    .from('quests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getActiveQuests() {
  const { data, error } = await sb
    .from('quests').select('*').eq('is_active', true)
    .order('type').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createQuest(questData) {
  const { data, error } = await sb.from('quests').insert(questData).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function updateQuest(questId, updates) {
  const { data, error } = await sb.from('quests').update(updates).eq('id', questId).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function deleteQuest(questId) {
  const { error } = await sb.from('quests').delete().eq('id', questId);
  if (error) throw error;
}

export async function toggleQuestActive(questId, isActive) {
  return updateQuest(questId, { is_active: isActive });
}

// ─── SUBMISSIONS (quests) ─────────────────────────────────────
// proof_url: URL de screenshot (prnt.sc, imgur, etc.) OU base64 (apenas se image_required=true)

export async function createSubmission(userId, questId, proofUrl) {
  // Garante perfil
  const { data: userRow } = await sb.from('users').select('id').eq('id', userId).maybeSingle();
  if (!userRow) throw new Error('Perfil não encontrado. Faça logout e login novamente.');

  // Busca quest para verificar cooldown e proof_required
  const { data: quest } = await sb.from('quests')
    .select('cooldown_hours, proof_required').eq('id', questId).single();

  // Verifica submissão existente (mais recente)
  const { data: existing } = await sb
    .from('submissions')
    .select('id, status, cooldown_until')
    .eq('user_id', userId)
    .eq('quest_id', questId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

    if (existing) {
      if (existing.status === 'approved') {
        if (quest?.cooldown_hours > 0 && existing.cooldown_until) {
          const until = new Date(existing.cooldown_until);
          if (until > new Date()) {
            const diffH = Math.ceil((until - new Date()) / 3600000);
            const diffM = Math.ceil((until - new Date()) / 60000);
            const msg = diffH >= 1
              ? `Quest em cooldown! Disponível em ${diffH}h.`
              : `Quest em cooldown! Disponível em ${diffM} min.`;
            throw new Error(msg);
          }
        } else if (quest?.cooldown_hours === 0) {
          throw new Error('Quest já foi concluída!');
        }
      } else if (existing.status === 'pending') {
        throw new Error('Quest já está em análise!');
      }
      // 'rejected' → permite reenvio
    }

  const { data, error } = await sb.from('submissions').insert({
    user_id:  userId,
    quest_id: questId,
    proof_url: proofUrl || null,
    status:   'pending'
  }).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getUserSubmissions(userId) {
  const { data, error } = await sb
    .from('submissions')
    .select(`*, quests(title, type, reward_coins, reward_xp, icon_url, cooldown_hours, proof_required)`)
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPendingSubmissions() {
  const { data, error } = await sb
    .from('submissions')
    .select(`*, users(nickname, profile_nickname, icon_url), quests(title, type, reward_coins, reward_xp, icon_url)`)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function approveSubmission(submissionId) {
  const { data: sub, error: subErr } = await sb
    .from('submissions')
    .select(`*, quests(reward_coins, reward_xp, cooldown_hours), users(coins, xp, level, coins_daily, coins_weekly, coins_monthly)`)
    .eq('id', submissionId).single();
  if (subErr) throw subErr;

  const rc = sub.quests?.reward_coins || 0;
  const rx = sub.quests?.reward_xp    || 0;
  const u  = sub.users;

  const newXp    = (u.xp    || 0) + rx;
  const newCoins = (u.coins || 0) + rc;
  const newLevel = calcLevel(newXp);

  // Próximo cooldown às 01:45
  let cooldownUntil = null;
  const ch = sub.quests?.cooldown_hours || 0;
  if (ch > 0) cooldownUntil = getNextReset(ch);

  await sb.from('users').update({
    coins:         newCoins,
    xp:            newXp,
    level:         newLevel,
    coins_daily:   (u.coins_daily   || 0) + rc,
    coins_weekly:  (u.coins_weekly  || 0) + rc,
    coins_monthly: (u.coins_monthly || 0) + rc,
    updated_at:    new Date().toISOString()
  }).eq('id', sub.user_id);

  const { data, error } = await sb.from('submissions')
    .update({ status: 'approved', reviewed_at: new Date().toISOString(), cooldown_until: cooldownUntil })
    .eq('id', submissionId).select();
  if (error) throw error;

  await checkAndGrantAchievements(sub.user_id);
  return data?.[0] ?? null;
}

export async function rejectSubmission(submissionId) {
  const { data, error } = await sb.from('submissions')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', submissionId).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

// ─── MAP SUBMISSIONS (usuário envia, admin aprova) ────────────
// image_url: URL de screenshot (não base64)

export async function submitMapByUser(userId, mapData) {
  const { data: userRow } = await sb.from('users').select('id').eq('id', userId).maybeSingle();
  if (!userRow) throw new Error('Perfil não encontrado. Faça logout e login novamente.');

  const { data, error } = await sb.from('map_submissions').insert({
    user_id:      userId,
    title:        mapData.title,
    description:  mapData.description || '',
    type:         mapData.type || 'adventure',
    download_url: mapData.download_url || null,
    image_url:    mapData.image_url   || null,   // URL, não base64
    status:       'pending'
  }).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getUserMapSubmissions(userId) {
  const { data, error } = await sb
    .from('map_submissions')
    .select('*')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPendingMapSubmissions() {
  const { data, error } = await sb
    .from('map_submissions')
    .select(`*, users(nickname, profile_nickname, icon_url)`)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Admin aprova submissão de mapa + define recompensas + cria entry em maps
export async function approveMapSubmission(mapSubId, rewards, adminNotes) {
  const { data: ms, error: msErr } = await sb
    .from('map_submissions').select('*').eq('id', mapSubId).single();
  if (msErr) throw msErr;

  const rc = rewards.reward_coins  || 0;
  const rx = rewards.reward_xp     || 0;
  const rt = rewards.reward_tokens || 0;

  // Cria o mapa aprovado na tabela maps
  const { data: newMap, error: mapErr } = await sb.from('maps').insert({
    title:        ms.title,
    description:  ms.description,
    type:         ms.type,
    image_url:    ms.image_url,   // URL propagada diretamente
    download_url: ms.download_url,
    submitted_by: ms.user_id,
    reward_coins:  rc,
    reward_xp:     rx,
    reward_tokens: rt,
    icon_url:     MAP_TYPE_ICONS[ms.type] || '🗺️'
  }).select();
  if (mapErr) throw mapErr;

  // Atualiza o map_submission
  await sb.from('map_submissions').update({
    status:       'approved',
    reviewed_at:  new Date().toISOString(),
    reward_coins: rc, reward_xp: rx, reward_tokens: rt,
    admin_notes:  adminNotes || null
  }).eq('id', mapSubId);

  // Recompensa o usuário
  const { data: u } = await sb.from('users').select('coins,xp,level,tokens').eq('id', ms.user_id).maybeSingle();
  if (u) {
    const newXp    = (u.xp    || 0) + rx;
    const newLevel = calcLevel(newXp);
    await sb.from('users').update({
      coins:  (u.coins  || 0) + rc,
      xp:     newXp,
      level:  newLevel,
      tokens: (u.tokens || 0) + rt,
      updated_at: new Date().toISOString()
    }).eq('id', ms.user_id);
  }

  return newMap?.[0] ?? null;
}

export async function rejectMapSubmission(mapSubId, adminNotes) {
  const { error } = await sb.from('map_submissions').update({
    status:      'rejected',
    reviewed_at: new Date().toISOString(),
    admin_notes: adminNotes || null
  }).eq('id', mapSubId);
  if (error) throw error;
}

// ─── MAPS (aprovados) ─────────────────────────────────────────

export async function getAllMaps() {
  const { data, error } = await sb
    .from('maps')
    .select('*, users(nickname, profile_nickname)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createMap(mapData) {
  const { data, error } = await sb.from('maps').insert(mapData).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function updateMap(mapId, updates) {
  const { data, error } = await sb.from('maps').update(updates).eq('id', mapId).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function deleteMap(mapId) {
  const { error } = await sb.from('maps').delete().eq('id', mapId);
  if (error) throw error;
}

export function hasLikedMap(userId, mapId) {
  return !!localStorage.getItem(`map_liked_${userId}_${mapId}`);
}

export async function likeMap(mapId, userId) {
  const storageKey = `map_liked_${userId}_${mapId}`;
  if (localStorage.getItem(storageKey)) {
    // UNLIKE: decrement
    const { data: m } = await sb.from('maps').select('likes_count').eq('id', mapId).single();
    if (m) {
      await sb.from('maps').update({ likes_count: Math.max(0, (m.likes_count || 1) - 1) }).eq('id', mapId);
    }
    localStorage.removeItem(storageKey);
    return false; // unliked
  }
  const { error } = await sb.rpc('increment_map_likes', { map_id: mapId });
  if (error) throw error;
  localStorage.setItem(storageKey, '1');
  return true; // liked
}

export async function incrementMapView(mapId) {
  const { error } = await sb.rpc('increment_map_views', { map_id: mapId });
  if (error) {
    // Fallback: update directly if RPC doesn't exist yet
    const { data: m } = await sb.from('maps').select('views_count').eq('id', mapId).single();
    if (m) await sb.from('maps').update({ views_count: (m.views_count || 0) + 1 }).eq('id', mapId);
  }
}

// ─── RANKING ──────────────────────────────────────────────────

// Retorna a data/hora atual em BRT como objeto {year, month, day, hour, minute, dayOfWeek}
// Usa toLocaleString com timeZone para extrair corretamente os campos — evita
// o bug de setHours() que operava sobre UTC internamente.
function _brtNow() {
  const now = new Date();
  // Formata em pt-BR para obter partes da data em BRT
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short'
  });
  const parts = {};
  fmt.formatToParts(now).forEach(({ type, value }) => { parts[type] = value; });
  // parts: day='24', month='04', year='2026', hour='10', minute='35', weekday='qui.'
  return {
    year:      parseInt(parts.year,  10),
    month:     parseInt(parts.month, 10), // 1-12
    day:       parseInt(parts.day,   10),
    hour:      parseInt(parts.hour,  10),
    minute:    parseInt(parts.minute,10),
    // dayOfWeek: 0=dom,1=seg,...6=sab — via getDay() em UTC ajustado
    dayOfWeek: new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()
  };
}

// Constrói um Date UTC a partir de ano/mês/dia BRT + hora/min/seg
function _brtToUtc(year, month, day, hour = 0, min = 0, sec = 0) {
  // Monta string ISO com offset -03:00 e converte para Date UTC
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return new Date(`${pad(year,4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(min)}:${pad(sec)}-03:00`);
}

// Retorna {start, end} do período atual em BRT (UTC-3)
function getPeriodRange(type) {
  const b = _brtNow();

  if (type === 'daily') {
    const start = _brtToUtc(b.year, b.month, b.day,  0,  0,  0);
    const end   = _brtToUtc(b.year, b.month, b.day, 23, 59, 59);
    return { start, end };
  }

  if (type === 'weekly') {
    // Segunda (1) → Domingo (0): diff para chegar na segunda
    const dow = b.dayOfWeek; // 0=dom
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    // Calcula data da segunda em BRT
    const monDate = new Date(_brtToUtc(b.year, b.month, b.day));
    monDate.setUTCDate(monDate.getUTCDate() + diffToMon);
    // Recalcula ano/mês/dia da segunda em BRT
    const monBrt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(monDate);
    const mp = {}; monBrt.forEach(({ type: t, value: v }) => { mp[t] = v; });
    const mY = parseInt(mp.year, 10), mM = parseInt(mp.month, 10), mD = parseInt(mp.day, 10);
    const start = _brtToUtc(mY, mM, mD, 0, 0, 0);
    // Domingo = segunda + 6 dias
    const sunDate = new Date(start.getTime() + 6 * 86400000);
    const sunBrt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(sunDate);
    const sp = {}; sunBrt.forEach(({ type: t, value: v }) => { sp[t] = v; });
    const sY = parseInt(sp.year, 10), sM = parseInt(sp.month, 10), sD = parseInt(sp.day, 10);
    const end = _brtToUtc(sY, sM, sD, 23, 59, 59);
    return { start, end };
  }

  if (type === 'monthly') {
    const start = _brtToUtc(b.year, b.month, 1,  0,  0,  0);
    // Último dia do mês: dia 0 do próximo mês
    const lastDay = new Date(Date.UTC(b.year, b.month, 0)).getUTCDate();
    const end   = _brtToUtc(b.year, b.month, lastDay, 23, 59, 59);
    return { start, end };
  }

  return null;
}

export function getRankingPeriodLabel(type) {
  const range = getPeriodRange(type);
  if (!range) return null;
  // Formata datas em BRT (America/Sao_Paulo) para exibição correta
  const fmtDate = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric' });
  const fmtTime = (d) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return `${fmtDate(range.start)} [${fmtTime(range.start)}] até ${fmtDate(range.end)} [${fmtTime(range.end)}]`;
}

export async function getRanking(type = 'total', metric = 'coins') {
  const prefix = metric === 'tokens' ? 'tokens' : 'coins';
  const fieldMap = {
    total:   prefix,
    daily:   `${prefix}_daily`,
    weekly:  `${prefix}_weekly`,
    monthly: `${prefix}_monthly`
  };
  const field = fieldMap[type] || prefix;

  const { data, error } = await sb
    .from('users')
    .select(`id, nickname, profile_nickname, icon_url, level, ${field}`)
    .gt(field, 0)
    .order(field, { ascending: false })
    .limit(50);
  if (error) throw error;
  const periodLabel = type !== 'total' ? getRankingPeriodLabel(type) : null;
  return (data ?? []).map(u => ({
    ...u,
    displayName: u.profile_nickname || u.nickname,
    score: u[field] || 0,
    periodLabel
  }));
}

export function subscribeRanking(type, metric, callback) {
  const ch = sb.channel(`ranking-${type}-${metric}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => {
      callback(await getRanking(type, metric));
    }).subscribe();
  return ch;
}

export function unsubscribeRanking(channel) {
  if (channel) sb.removeChannel(channel);
}

// ─── ACHIEVEMENTS ─────────────────────────────────────────────

export async function getAllAchievements() {
  const { data, error } = await sb
    .from('achievements').select('*').order('quests_required', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createAchievement(d) {
  const { data, error } = await sb.from('achievements').insert(d).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function updateAchievement(id, d) {
  const { data, error } = await sb.from('achievements').update(d).eq('id', id).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function deleteAchievement(id) {
  const { error } = await sb.from('achievements').delete().eq('id', id);
  if (error) throw error;
}

export async function getUserBadges(userId) {
  const { data, error } = await sb
    .from('user_badges').select(`*, achievements(*)`).eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

export async function checkAndGrantAchievements(userId) {
  try {
    const { count: questCount } = await sb
      .from('submissions').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'approved');
    const { data: user }   = await sb.from('users').select('level').eq('id', userId).maybeSingle();
    const { data: badges } = await sb.from('user_badges').select('achievement_id').eq('user_id', userId);
    const earned = new Set((badges || []).map(b => b.achievement_id));
    const achs   = await getAllAchievements();
    for (const a of achs) {
      if (earned.has(a.id)) continue;
      if ((!a.level_required   || (user?.level || 1) >= a.level_required) &&
          (!a.quests_required  || (questCount || 0) >= a.quests_required)) {
        await sb.from('user_badges').upsert(
          { user_id: userId, achievement_id: a.id },
          { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
        );
        if (a.reward_coins > 0 || a.reward_xp > 0) {
          const { data: u } = await sb.from('users').select('coins,xp').eq('id', userId).maybeSingle();
          if (u) await sb.from('users').update({
            coins: (u.coins || 0) + (a.reward_coins || 0),
            xp:    (u.xp    || 0) + (a.reward_xp   || 0)
          }).eq('id', userId);
        }
      }
    }
  } catch (e) { console.warn('checkAndGrantAchievements:', e); }
}

// ─── RANKING RESETS ───────────────────────────────────────────

// Gera label de período para o histórico, no formato:
// "DD/MM/AAAA [HH:MM] até DD/MM/AAAA [HH:MM] BRT"
function brtPeriodLabel(type) {
  const range = getPeriodRange(type);
  if (!range) {
    const fallback = new Date();
    return fallback.toLocaleDateString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric' }) + ' BRT';
  }
  const fmtDate = (d) => d.toLocaleDateString('pt-BR',  { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric' });
  const fmtTime = (d) => d.toLocaleTimeString('pt-BR',  { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return `${fmtDate(range.start)} [${fmtTime(range.start)}] até ${fmtDate(range.end)} [${fmtTime(range.end)}] BRT`;
}

// Insere registro no ranking_reset_log (tabela criada pela migração v10)
async function _logReset(type, label) {
  try {
    await sb.from('ranking_reset_log').insert({ reset_type: type, period_label: label });
  } catch (e) {
    // Tabela pode não existir ainda (antes de aplicar migração v10) — ignora silenciosamente
    console.warn('ranking_reset_log insert skipped (run migration v10):', e.message);
  }
}

export async function resetDailyRanking() {
  const { data: users } = await sb.from('users').select('id,coins_daily,tokens_daily')
    .or('coins_daily.gt.0,tokens_daily.gt.0');
  const label = brtPeriodLabel('daily');
  if (users?.length) {
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'daily', score_coins: u.coins_daily || 0, score_tokens: u.tokens_daily || 0, period_label: label }))
    );
  }
  await sb.from('users').update({ coins_daily: 0, tokens_daily: 0 })
    .or('coins_daily.gt.0,tokens_daily.gt.0');
  await _logReset('daily', label);
}

export async function resetWeeklyRanking() {
  const { data: users } = await sb.from('users').select('id,coins_weekly,tokens_weekly')
    .or('coins_weekly.gt.0,tokens_weekly.gt.0');
  const label = brtPeriodLabel('weekly');
  if (users?.length) {
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'weekly', score_coins: u.coins_weekly || 0, score_tokens: u.tokens_weekly || 0, period_label: label }))
    );
  }
  await sb.from('users').update({ coins_weekly: 0, tokens_weekly: 0 })
    .or('coins_weekly.gt.0,tokens_weekly.gt.0');
  await _logReset('weekly', label);
}

export async function resetMonthlyRanking() {
  const { data: users } = await sb.from('users').select('id,coins_monthly,tokens_monthly')
    .or('coins_monthly.gt.0,tokens_monthly.gt.0');
  const label = brtPeriodLabel('monthly');
  if (users?.length) {
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'monthly', score_coins: u.coins_monthly || 0, score_tokens: u.tokens_monthly || 0, period_label: label }))
    );
  }
  await sb.from('users').update({ coins_monthly: 0, tokens_monthly: 0 })
    .or('coins_monthly.gt.0,tokens_monthly.gt.0');
  await _logReset('monthly', label);
}

// ─── AUTO-RESET (fallback client-side) ────────────────────────

/**
 * Retorna o status do último reset de cada tipo a partir da tabela
 * ranking_reset_log (criada pela migração v10). Retorna null por tipo
 * se a tabela ainda não existir.
 */
export async function getRankingResetStatus() {
  try {
    const { data, error } = await sb
      .from('ranking_reset_log')
      .select('reset_type, reset_at, period_label, rows_saved')
      .order('reset_at', { ascending: false })
      .limit(30);
    if (error) throw error;

    // Pega o registro mais recente de cada tipo
    const status = { daily: null, weekly: null, monthly: null };
    for (const row of (data ?? [])) {
      if (!status[row.reset_type]) status[row.reset_type] = row;
    }
    return status;
  } catch (e) {
    // Tabela não existe ainda — retorna estrutura vazia
    console.warn('getRankingResetStatus: tabela ranking_reset_log não encontrada. Execute a migração v10.');
    return { daily: null, weekly: null, monthly: null };
  }
}

/**
 * Calcula o próximo horário de reset de cada tipo em BRT.
 * Retorna { daily, weekly, monthly } com objetos Date (UTC).
 */
export function getNextResetTimes() {
  const b    = _brtNow();
  const now  = new Date();

  // Próximo reset diário: 01:45 BRT do dia seguinte (ou hoje se ainda não passou)
  const todayReset = _brtToUtc(b.year, b.month, b.day, 1, 45, 0);
  const dailyNext  = todayReset > now ? todayReset
    : _brtToUtc(b.year, b.month, b.day + 1, 1, 45, 0);

  // Próximo reset semanal: segunda-feira 01:50 BRT da próxima semana (ou desta semana)
  const dow      = b.dayOfWeek; // 0=dom
  const daysToMon = dow === 1 ? 0 : dow === 0 ? 1 : (8 - dow);
  const thisMonReset = (() => {
    const d = _brtToUtc(b.year, b.month, b.day, 1, 50, 0);
    d.setUTCDate(d.getUTCDate() + (dow === 1 ? 0 : daysToMon));
    return d;
  })();
  const weeklyNext = thisMonReset > now ? thisMonReset
    : new Date(thisMonReset.getTime() + 7 * 86400000);

  // Próximo reset mensal: dia 1 do próximo mês 01:55 BRT
  const thisMonthReset = _brtToUtc(b.year, b.month, 1, 1, 55, 0);
  let monthlyNext;
  if (thisMonthReset > now) {
    monthlyNext = thisMonthReset;
  } else {
    // Próximo mês (pode virar ano)
    const nm = b.month === 12 ? 1 : b.month + 1;
    const ny = b.month === 12 ? b.year + 1 : b.year;
    monthlyNext = _brtToUtc(ny, nm, 1, 1, 55, 0);
  }

  return { daily: dailyNext, weekly: weeklyNext, monthly: monthlyNext };
}

/**
 * checkAndAutoReset — verifica se o reset do período atual já foi feito.
 * Usado como fallback quando o pg_cron não está configurado.
 * Só executa se o horário atual for >= 01:45 BRT e o último reset foi
 * em um período anterior ao atual.
 * Retorna array de tipos resetados (ex: ['daily', 'weekly']).
 */
export async function checkAndAutoReset() {
  const resetDone = [];
  try {
    const b   = _brtNow();
    const now = new Date();

    // Só age na janela de manutenção (01:45 – 02:10 BRT)
    const inWindow = (b.hour === 1 && b.minute >= 45) || (b.hour === 2 && b.minute < 10);
    if (!inWindow) return resetDone;

    const status = await getRankingResetStatus();

    // ── Reset diário ──────────────────────────────────────────
    const dailyStart = _brtToUtc(b.year, b.month, b.day, 0, 0, 0);
    const lastDaily  = status.daily ? new Date(status.daily.reset_at) : null;
    if (!lastDaily || lastDaily < dailyStart) {
      await resetDailyRanking();
      resetDone.push('daily');
    }

    // ── Reset semanal (segunda-feira) ─────────────────────────
    const dow       = b.dayOfWeek;
    const isMonday  = dow === 1;
    if (isMonday) {
      const weekStart = _brtToUtc(b.year, b.month, b.day, 0, 0, 0);
      const lastWeekly = status.weekly ? new Date(status.weekly.reset_at) : null;
      if (!lastWeekly || lastWeekly < weekStart) {
        await resetWeeklyRanking();
        resetDone.push('weekly');
      }
    }

    // ── Reset mensal (dia 1 de cada mês) ─────────────────────
    if (b.day === 1) {
      const monthStart  = _brtToUtc(b.year, b.month, 1, 0, 0, 0);
      const lastMonthly = status.monthly ? new Date(status.monthly.reset_at) : null;
      if (!lastMonthly || lastMonthly < monthStart) {
        await resetMonthlyRanking();
        resetDone.push('monthly');
      }
    }
  } catch (e) {
    console.warn('checkAndAutoReset error:', e.message);
  }
  return resetDone;
}

// ─── UTILS ────────────────────────────────────────────────────

export function calcLevel(xp) { return Math.max(1, Math.floor(Math.sqrt((xp || 0) / 100)) + 1); }
export function xpForLevel(l) { return (l - 1) ** 2 * 100; }
export function xpForNextLevel(l) { return l ** 2 * 100; }

export function getWeekLabel() {
  const d = new Date(), jan1 = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export function isMaintenanceTime() {
  const h = new Date().getHours(), m = new Date().getMinutes();
  return (h === 1 && m >= 45) || (h === 2 && m < 5);
}

// Calcula próximo reset às 01:45 (BRT) respeitando cooldown_hours
export function getNextReset(cooldownHours) {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(1, 45, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const minNext = new Date(now.getTime() + cooldownHours * 3600000);
  return (minNext > next ? minNext : next).toISOString();
}

// Formata cooldown_until em texto legível
export function formatCooldown(isoDate) {
  if (!isoDate) return null;
  const until = new Date(isoDate);
  const now   = new Date();
  if (until <= now) return null;
  const diffMs = until - now;
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

// Upload de imagem como base64 — SOMENTE para capa de mapas (admin)
export async function uploadProofImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('Nenhum arquivo')); return; }
    if (file.size > 3 * 1024 * 1024) { reject(new Error('Imagem muito grande! Máximo: 3MB')); return; }
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) { reject(new Error('Use JPG, PNG, GIF ou WEBP')); return; }
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

// ─── SHOP ─────────────────────────────────────────────────────

export async function getShopItems() {
  const { data, error } = await sb
    .from('shop_items')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAllShopItems() {
  const { data, error } = await sb
    .from('shop_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createShopItem(d) {
  const { data, error } = await sb.from('shop_items').insert(d).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function updateShopItem(id, d) {
  const { data, error } = await sb.from('shop_items').update(d).eq('id', id).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function deleteShopItem(id) {
  const { error } = await sb.from('shop_items').delete().eq('id', id);
  if (error) throw error;
}

export async function buyShopItem(userId, itemId) {
  // 1. Pega item
  const { data: item, error: itemErr } = await sb
    .from('shop_items').select('*').eq('id', itemId).single();
  if (itemErr) throw itemErr;
  if (!item.is_active) throw new Error('Item não disponível');
  if (item.stock === 0) throw new Error('Item esgotado!');

  // 2. Pega usuário
  const { data: user, error: userErr } = await sb
    .from('users').select('coins, tokens').eq('id', userId).single();
  if (userErr) throw userErr;

  let paidCoins = 0, paidTokens = 0;
  if (item.currency === 'coins' || item.currency === 'both') {
    if ((user.coins || 0) < item.price_coins) throw new Error('Moedas insuficientes!');
    paidCoins = item.price_coins;
  }
  if (item.currency === 'tokens' || item.currency === 'both') {
    if ((user.tokens || 0) < item.price_tokens) throw new Error('Tokens insuficientes!');
    paidTokens = item.price_tokens;
  }

  // 3. Debita usuário
  await sb.from('users').update({
    coins:  (user.coins  || 0) - paidCoins,
    tokens: (user.tokens || 0) - paidTokens,
    updated_at: new Date().toISOString()
  }).eq('id', userId);

  // 4. Decrementa stock (se não ilimitado)
  if (item.stock > 0) {
    await sb.from('shop_items').update({ stock: item.stock - 1 }).eq('id', itemId);
  }

  // 5. Registra compra
  const { error: purchErr } = await sb.from('shop_purchases').insert({
    user_id: userId, item_id: itemId,
    qty: 1, paid_coins: paidCoins, paid_tokens: paidTokens
  });
  if (purchErr) throw purchErr;
}

export async function getUserPurchases(userId) {
  const { data, error } = await sb
    .from('shop_purchases')
    .select('*, shop_items(name, icon_url, description)')
    .eq('user_id', userId)
    .order('purchased_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAllPurchases() {
  const { data, error } = await sb
    .from('shop_purchases')
    .select('*, shop_items(name, icon_url), users(nickname, profile_nickname)')
    .order('purchased_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getShopFavorites(userId) {
  const { data, error } = await sb
    .from('shop_favorites')
    .select('item_id')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

export async function addShopFavorite(userId, itemId) {
  const { error } = await sb.from('shop_favorites').upsert(
    { user_id: userId, item_id: itemId },
    { onConflict: 'user_id,item_id', ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function removeShopFavorite(userId, itemId) {
  const { error } = await sb.from('shop_favorites')
    .delete().eq('user_id', userId).eq('item_id', itemId);
  if (error) throw error;
}

// ─── RANKING HISTORY ──────────────────────────────────────────

/**
 * Busca histórico de rankings agrupado por período.
 * @param {string} scoreType  'daily' | 'weekly' | 'monthly'
 * @param {string} metric     'coins' | 'tokens'
 * @param {number} limitPeriods  Máx. de períodos a retornar (0 = todos)
 * @returns {Array} Registros do ranking_history com join em users
 */
export async function getRankingHistory(scoreType, metric = 'coins', limitPeriods = 5) {
  const scoreField = metric === 'tokens' ? 'score_tokens' : 'score_coins';
  const fetchLimit = limitPeriods > 0 ? limitPeriods * 50 : 500;
  const { data, error } = await sb
    .from('ranking_history')
    .select(`id, user_id, score_type, score_coins, score_tokens, period_label, recorded_at,
             users(nickname, profile_nickname, icon_url)`)
    .eq('score_type', scoreType)
    .order('period_label', { ascending: false })
    .order(scoreField,     { ascending: false })
    .limit(fetchLimit);
  if (error) {
    console.error('getRankingHistory error:', error);
    throw error;
  }
  return data ?? [];
}

// ─── HALL DA FAMA ─────────────────────────────────────────────

/**
 * Busca Hall da Fama: os campeões de cada período historicamente.
 * @param {string} scoreType 'daily'|'weekly'|'monthly'
 * @param {string} metric    'coins'|'tokens'
 * @param {number} limit     Quantos registros retornar
 */
export async function getHallOfFame(scoreType = 'monthly', metric = 'coins', limit = 20) {
  try {
    const { data, error } = await sb
      .from('hall_of_fame')
      .select(`id, user_id, score_type, metric, score, period_label, recorded_at,
               users(nickname, profile_nickname, icon_url, level)`)
      .eq('score_type', scoreType)
      .eq('metric', metric)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.warn('getHallOfFame: tabela hall_of_fame não encontrada. Execute migração v11.', e.message);
    return [];
  }
}

/**
 * Registra manualmente o campeão atual no Hall da Fama (antes de reset).
 * Chamado pelo resetDailyRanking/Weekly/Monthly como fallback client-side.
 */
async function _recordHallOfFame(type, label) {
  try {
    const scoreCol = { daily:'coins_daily', weekly:'coins_weekly', monthly:'coins_monthly' }[type];
    const tokCol   = { daily:'tokens_daily', weekly:'tokens_weekly', monthly:'tokens_monthly' }[type];
    if (!scoreCol) return;

    // Top moedas
    const { data: topCoins } = await sb.from('users')
      .select(`id, ${scoreCol}`)
      .gt(scoreCol, 0)
      .order(scoreCol, { ascending: false })
      .limit(1);
    if (topCoins?.[0]) {
      await sb.from('hall_of_fame').insert({
        user_id: topCoins[0].id, score_type: type, metric: 'coins',
        score: topCoins[0][scoreCol] || 0, period_label: label
      });
    }

    // Top tokens
    const { data: topTok } = await sb.from('users')
      .select(`id, ${tokCol}`)
      .gt(tokCol, 0)
      .order(tokCol, { ascending: false })
      .limit(1);
    if (topTok?.[0]) {
      await sb.from('hall_of_fame').insert({
        user_id: topTok[0].id, score_type: type, metric: 'tokens',
        score: topTok[0][tokCol] || 0, period_label: label
      });
    }
  } catch (e) {
    console.warn('_recordHallOfFame skipped (run migration v11):', e.message);
  }
}

// Sobrescreve os resets para também registrar Hall da Fama (client fallback)
const _origResetDaily   = resetDailyRanking;
const _origResetWeekly  = resetWeeklyRanking;
const _origResetMonthly = resetMonthlyRanking;

export async function resetDailyRankingFull() {
  const label = brtPeriodLabel('daily');
  await _recordHallOfFame('daily', label);
  await _origResetDaily();
}
export async function resetWeeklyRankingFull() {
  const label = brtPeriodLabel('weekly');
  await _recordHallOfFame('weekly', label);
  await _origResetWeekly();
}
export async function resetMonthlyRankingFull() {
  const label = brtPeriodLabel('monthly');
  await _recordHallOfFame('monthly', label);
  await _origResetMonthly();
}

// ─── AMIZADES / SEGUIDORES ────────────────────────────────────

export async function sendFriendRequest(myId, targetId) {
  const { error } = await sb.from('friendships').insert({
    requester: myId, addressee: targetId, status: 'pending'
  });
  if (error) throw error;
}

export async function acceptFriendRequest(myId, requesterId) {
  const { error } = await sb.from('friendships')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('requester', requesterId)
    .eq('addressee', myId)
    .eq('status', 'pending');
  if (error) throw error;
}

export async function removeFriend(myId, otherId) {
  await sb.from('friendships')
    .delete()
    .or(`and(requester.eq.${myId},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${myId})`);
}

export async function getFriends(userId) {
  try {
    const { data, error } = await sb
      .from('friendships')
      .select(`id, status, created_at,
               requester, addressee,
               req:requester(id, nickname, profile_nickname, icon_url, level),
               adr:addressee(id, nickname, profile_nickname, icon_url, level)`)
      .or(`requester.eq.${userId},addressee.eq.${userId}`)
      .eq('status', 'accepted');
    if (error) throw error;
    // Normaliza: retorna sempre o "outro" usuário
    return (data ?? []).map(r => {
      const other = r.requester === userId ? r.adr : r.req;
      return { ...r, friend: other };
    });
  } catch (e) {
    console.warn('getFriends: tabela friendships não encontrada. Execute migração v11.');
    return [];
  }
}

export async function getFriendRequests(userId) {
  try {
    const { data, error } = await sb
      .from('friendships')
      .select(`id, status, created_at,
               req:requester(id, nickname, profile_nickname, icon_url, level)`)
      .eq('addressee', userId)
      .eq('status', 'pending');
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.warn('getFriendRequests: tabela friendships não encontrada.');
    return [];
  }
}

export async function getFriendshipStatus(myId, otherId) {
  try {
    const { data } = await sb.from('friendships')
      .select('id, status, requester, addressee')
      .or(`and(requester.eq.${myId},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${myId})`)
      .maybeSingle();
    return data ?? null;
  } catch (e) { return null; }
}

// ─── MISSÕES EM GRUPO ─────────────────────────────────────────

export async function getGroupMissions(statusFilter = 'open') {
  try {
    let q = sb.from('group_missions')
      .select(`*, creator:creator_id(id, nickname, profile_nickname, icon_url),
               quest:quest_id(id, title, type, reward_coins, reward_xp),
               members:group_mission_members(user_id, role,
                 user:user_id(id, nickname, profile_nickname, icon_url))`)
      .order('created_at', { ascending: false });
    if (statusFilter && statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data, error } = await q.limit(50);
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.warn('getGroupMissions: tabela não encontrada. Execute migração v11.');
    return [];
  }
}

export async function createGroupMission(data) {
  const { data: result, error } = await sb
    .from('group_missions')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  // Auto-ingressa o criador como líder
  await sb.from('group_mission_members').insert({
    mission_id: result.id, user_id: data.creator_id, role: 'leader'
  });
  return result;
}

export async function joinGroupMission(missionId, userId) {
  // Verifica capacidade
  const { data: m } = await sb.from('group_missions')
    .select('max_members, status')
    .eq('id', missionId).single();
  if (!m || m.status !== 'open') throw new Error('Missão não está aberta');
  const { count } = await sb.from('group_mission_members')
    .select('*', { count: 'exact', head: true })
    .eq('mission_id', missionId);
  if (count >= m.max_members) throw new Error('Grupo cheio!');
  const { error } = await sb.from('group_mission_members')
    .insert({ mission_id: missionId, user_id: userId, role: 'member' });
  if (error) throw error;
  // Atualiza status se ficou cheio
  if (count + 1 >= m.max_members) {
    await sb.from('group_missions').update({ status: 'in_progress' }).eq('id', missionId);
  }
}

export async function leaveGroupMission(missionId, userId) {
  const { error } = await sb.from('group_mission_members')
    .delete().eq('mission_id', missionId).eq('user_id', userId);
  if (error) throw error;
}

// ─── MODERAÇÃO DE CONTEÚDO ────────────────────────────────────

export async function voteContent(userId, targetType, targetId, vote, reason = null) {
  try {
    const { error } = await sb.from('content_votes').upsert({
      user_id: userId, target_type: targetType, target_id: targetId,
      vote, reason
    }, { onConflict: 'user_id,target_type,target_id' });
    if (error) throw error;
  } catch (e) {
    console.warn('voteContent: tabela não encontrada. Execute migração v11.');
    throw e;
  }
}

export async function getContentVotes(targetType, targetId) {
  try {
    const { data, error } = await sb.from('content_votes')
      .select('*, users(nickname, profile_nickname)')
      .eq('target_type', targetType)
      .eq('target_id', targetId);
    if (error) throw error;
    return data ?? [];
  } catch (e) { return []; }
}

// ─── PERFIL PÚBLICO ───────────────────────────────────────────

export async function getPublicProfile(nickname) {
  try {
    const { data, error } = await sb.from('users')
      .select(`id, nickname, profile_nickname, profile_role, icon_url, level, xp,
               coins, tokens, public_profile, profile_bio, social_links, created_at,
               user_badges(earned_at, achievements(title, icon_url, description))`)
      .eq('nickname', nickname)
      .eq('public_profile', true)
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) { return null; }
}

export async function updatePublicProfile(userId, { bio, socialLinks, isPublic }) {
  const upd = {};
  if (bio !== undefined)         upd.profile_bio   = bio;
  if (socialLinks !== undefined) upd.social_links  = socialLinks;
  if (isPublic !== undefined)    upd.public_profile = isPublic;
  const { error } = await sb.from('users').update(upd).eq('id', userId);
  if (error) throw error;
}

export async function searchPublicUsers(query) {
  try {
    const { data, error } = await sb.from('users')
      .select('id, nickname, profile_nickname, icon_url, level, public_profile')
      .or(`nickname.ilike.%${query}%,profile_nickname.ilike.%${query}%`)
      .eq('public_profile', true)
      .limit(20);
    if (error) throw error;
    return data ?? [];
  } catch (e) { return []; }
}

// ─── ANALYTICS ADMIN ──────────────────────────────────────────

export async function getAdminAnalytics() {
  try {
    const [
      { count: totalUsers },
      { count: totalQuests },
      { count: pendingSubs },
      { count: approvedSubs },
      { count: totalMaps },
      { count: totalPurchases }
    ] = await Promise.all([
      sb.from('users').select('*', { count: 'exact', head: true }),
      sb.from('quests').select('*', { count: 'exact', head: true }).eq('is_active', true),
      sb.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
      sb.from('maps').select('*', { count: 'exact', head: true }),
      sb.from('shop_purchases').select('*', { count: 'exact', head: true })
    ]);

    // Top usuário por moedas totais
    const { data: topUsers } = await sb.from('users')
      .select('id, nickname, profile_nickname, icon_url, coins, tokens, xp, level')
      .order('coins', { ascending: false })
      .limit(5);

    // Submissões recentes (últimos 7 dias)
    const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count: recentSubs } = await sb.from('submissions')
      .select('*', { count: 'exact', head: true })
      .gte('submitted_at', since7);

    // Usuários ativos (que fizeram submissão nos últimos 7 dias)
    const { data: activeUsers } = await sb.from('submissions')
      .select('user_id')
      .gte('submitted_at', since7)
      .limit(200);
    const activeCount = new Set((activeUsers ?? []).map(s => s.user_id)).size;

    // Compras por moeda/token
    const { data: purchases } = await sb.from('shop_purchases')
      .select('paid_coins, paid_tokens')
      .gte('purchased_at', since7);
    const revCoins  = (purchases ?? []).reduce((a, p) => a + (p.paid_coins  || 0), 0);
    const revTokens = (purchases ?? []).reduce((a, p) => a + (p.paid_tokens || 0), 0);

    return {
      totalUsers:   totalUsers   ?? 0,
      totalQuests:  totalQuests  ?? 0,
      pendingSubs:  pendingSubs  ?? 0,
      approvedSubs: approvedSubs ?? 0,
      totalMaps:    totalMaps    ?? 0,
      totalPurchases: totalPurchases ?? 0,
      recentSubs:   recentSubs   ?? 0,
      activeUsers:  activeCount,
      topUsers:     topUsers     ?? [],
      revenueCoins: revCoins,
      revenueTokens: revTokens
    };
  } catch (e) {
    console.error('getAdminAnalytics:', e);
    return null;
  }
}
