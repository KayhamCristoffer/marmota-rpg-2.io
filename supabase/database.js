// ============================================================
// SUPABASE DATABASE LAYER - Substitui firebase/database.js
// Todas as operações de banco de dados
// ============================================================
import { sb, getCurrentUser } from './client.js';
import { ADMIN_UID } from './supabase-config.js';

// ─── AUTH ─────────────────────────────────────────────────────

export async function signUp(email, password, nickname) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  const user = data.user;
  // Cria perfil na tabela users
  const { error: profileError } = await sb.from('users').insert({
    id: user.id,
    email,
    nickname,
    username: nickname,
    role: 'user',
    level: 1,
    xp: 0,
    coins: 0,
    tokens: 0
  });
  if (profileError) throw profileError;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/index.html'
  });
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null, event);
  });
  return subscription;
}

// ─── USERS ────────────────────────────────────────────────────

export async function getUser(userId) {
  const { data, error } = await sb
    .from('users').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function updateUserProfile(userId, updates) {
  const { data, error } = await sb
    .from('users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select().single();
  if (error) throw error;
  return data;
}

export async function getAllUsers() {
  const { data, error } = await sb
    .from('users').select('*').order('coins', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setUserRole(userId, role) {
  return updateUserProfile(userId, { role });
}

// ─── QUESTS ───────────────────────────────────────────────────

export async function getAllQuests() {
  const { data, error } = await sb
    .from('quests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getActiveQuests() {
  const { data, error } = await sb
    .from('quests').select('*').eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createQuest(questData) {
  const { data, error } = await sb
    .from('quests').insert(questData).select().single();
  if (error) throw error;
  return data;
}

export async function updateQuest(questId, updates) {
  const { data, error } = await sb
    .from('quests').update(updates).eq('id', questId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteQuest(questId) {
  const { error } = await sb.from('quests').delete().eq('id', questId);
  if (error) throw error;
}

export async function toggleQuestActive(questId, isActive) {
  return updateQuest(questId, { is_active: isActive });
}

// ─── SUBMISSIONS ──────────────────────────────────────────────

export async function createSubmission(userId, questId, proofUrl) {
  // Verifica se já existe submissão ativa
  const { data: existing } = await sb
    .from('submissions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('quest_id', questId)
    .in('status', ['pending', 'approved'])
    .maybeSingle();

  if (existing) {
    throw new Error(existing.status === 'approved'
      ? 'Quest já foi concluída!'
      : 'Quest já está em análise!');
  }

  const { data, error } = await sb.from('submissions').insert({
    user_id: userId,
    quest_id: questId,
    proof_url: proofUrl,
    status: 'pending'
  }).select().single();
  if (error) throw error;
  return data;
}

export async function getUserSubmissions(userId) {
  const { data, error } = await sb
    .from('submissions')
    .select(`*, quests(title, type, reward_coins, reward_xp, icon_url)`)
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getPendingSubmissions() {
  const { data, error } = await sb
    .from('submissions')
    .select(`*, users(nickname, icon_url), quests(title, type, reward_coins, reward_xp)`)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function approveSubmission(submissionId) {
  // Busca submission com dados da quest e user
  const { data: sub, error: subErr } = await sb
    .from('submissions')
    .select(`*, quests(reward_coins, reward_xp), users(coins, xp, level, coins_daily, coins_weekly, coins_monthly)`)
    .eq('id', submissionId).single();
  if (subErr) throw subErr;

  const reward_coins = sub.quests.reward_coins || 0;
  const reward_xp    = sub.quests.reward_xp    || 0;
  const user         = sub.users;

  const newXp     = (user.xp || 0) + reward_xp;
  const newCoins  = (user.coins || 0) + reward_coins;
  const newLevel  = calcLevel(newXp);

  // Atualiza user
  await sb.from('users').update({
    coins:          newCoins,
    xp:             newXp,
    level:          newLevel,
    coins_daily:    (user.coins_daily  || 0) + reward_coins,
    coins_weekly:   (user.coins_weekly || 0) + reward_coins,
    coins_monthly:  (user.coins_monthly|| 0) + reward_coins,
    updated_at:     new Date().toISOString()
  }).eq('id', sub.user_id);

  // Atualiza submission
  const { data, error } = await sb.from('submissions')
    .update({ status: 'approved' }).eq('id', submissionId).select().single();
  if (error) throw error;

  // Verifica conquistas
  await checkAndGrantAchievements(sub.user_id);
  return data;
}

export async function rejectSubmission(submissionId) {
  const { data, error } = await sb.from('submissions')
    .update({ status: 'rejected' }).eq('id', submissionId).select().single();
  if (error) throw error;
  return data;
}

// ─── MAPS ─────────────────────────────────────────────────────

export async function getAllMaps() {
  const { data, error } = await sb
    .from('maps').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createMap(mapData) {
  const { data, error } = await sb
    .from('maps').insert(mapData).select().single();
  if (error) throw error;
  return data;
}

export async function updateMap(mapId, updates) {
  const { data, error } = await sb
    .from('maps').update(updates).eq('id', mapId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMap(mapId) {
  const { error } = await sb.from('maps').delete().eq('id', mapId);
  if (error) throw error;
}

export async function likeMap(mapId) {
  const { error } = await sb.rpc('increment_map_likes', { map_id: mapId });
  if (error) throw error;
}

// Submissão de mapa (como quest)
export async function createMapSubmission(userId, mapId, proofUrl) {
  const { data: existing } = await sb
    .from('submissions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('map_id', mapId)
    .in('status', ['pending', 'approved'])
    .maybeSingle();

  if (existing) throw new Error('Você já enviou este mapa!');

  const { data, error } = await sb.from('submissions').insert({
    user_id: userId,
    map_id: mapId,
    proof_url: proofUrl,
    status: 'pending'
  }).select().single();
  if (error) throw error;
  return data;
}

// ─── RANKING ──────────────────────────────────────────────────

export async function getRanking(type = 'coins') {
  const fieldMap = {
    total:   'coins',
    daily:   'coins_daily',
    weekly:  'coins_weekly',
    monthly: 'coins_monthly'
  };
  const field = fieldMap[type] || 'coins';
  const { data, error } = await sb
    .from('users')
    .select(`id, nickname, icon_url, level, ${field}`)
    .gt(field, 0)
    .order(field, { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map(u => ({ ...u, score: u[field] }));
}

// Subscrição em tempo real para ranking
export function subscribeRanking(type, callback) {
  const channel = sb
    .channel(`ranking-${type}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'users'
    }, async () => {
      const data = await getRanking(type);
      callback(data);
    })
    .subscribe();
  return channel;
}

export function unsubscribeRanking(channel) {
  if (channel) sb.removeChannel(channel);
}

// ─── ACHIEVEMENTS ─────────────────────────────────────────────

export async function getAllAchievements() {
  const { data, error } = await sb
    .from('achievements').select('*').order('quests_required', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createAchievement(achievementData) {
  const { data, error } = await sb
    .from('achievements').insert(achievementData).select().single();
  if (error) throw error;
  return data;
}

export async function updateAchievement(id, updates) {
  const { data, error } = await sb
    .from('achievements').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteAchievement(id) {
  const { error } = await sb.from('achievements').delete().eq('id', id);
  if (error) throw error;
}

export async function getUserBadges(userId) {
  const { data, error } = await sb
    .from('user_badges')
    .select(`*, achievements(*)`)
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

export async function checkAndGrantAchievements(userId) {
  try {
    // Conta quests aprovadas
    const { count: questCount } = await sb
      .from('submissions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'approved')
      .not('quest_id', 'is', null);

    const { data: user } = await sb.from('users').select('level').eq('id', userId).single();
    const { data: badges } = await sb.from('user_badges').select('achievement_id').eq('user_id', userId);
    const earnedIds = new Set((badges || []).map(b => b.achievement_id));
    const { data: achievements } = await getAllAchievements();

    for (const ach of (achievements || [])) {
      if (earnedIds.has(ach.id)) continue;
      const meetsLevel  = !ach.level_required  || user.level  >= ach.level_required;
      const meetsQuests = !ach.quests_required  || questCount >= ach.quests_required;
      if (meetsLevel && meetsQuests) {
        await sb.from('user_badges').insert({ user_id: userId, achievement_id: ach.id });
        // Bônus
        if (ach.reward_coins > 0 || ach.reward_xp > 0) {
          const { data: u } = await sb.from('users').select('coins, xp').eq('id', userId).single();
          await sb.from('users').update({
            coins: (u.coins || 0) + (ach.reward_coins || 0),
            xp:    (u.xp || 0) + (ach.reward_xp || 0)
          }).eq('id', userId);
        }
      }
    }
  } catch (e) {
    console.warn('checkAndGrantAchievements error:', e);
  }
}

// ─── RANKING RESETS ───────────────────────────────────────────

export async function resetDailyRanking() {
  // Salva histórico
  const { data: users } = await sb.from('users').select('id, coins_daily').gt('coins_daily', 0);
  if (users?.length) {
    const today = new Date().toISOString().split('T')[0];
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'daily', score_value: u.coins_daily, period_label: today }))
    );
  }
  // Zera contadores diários
  await sb.from('users').update({ coins_daily: 0 }).gt('coins_daily', 0);
  await sb.from('users').update({ tokens_daily: 0 }).gt('tokens_daily', 0);
}

export async function resetWeeklyRanking() {
  const { data: users } = await sb.from('users').select('id, coins_weekly').gt('coins_weekly', 0);
  if (users?.length) {
    const week = getWeekLabel();
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'weekly', score_value: u.coins_weekly, period_label: week }))
    );
  }
  await sb.from('users').update({ coins_weekly: 0 }).gt('coins_weekly', 0);
  await sb.from('users').update({ tokens_weekly: 0 }).gt('tokens_weekly', 0);
}

export async function resetMonthlyRanking() {
  const { data: users } = await sb.from('users').select('id, coins_monthly').gt('coins_monthly', 0);
  if (users?.length) {
    const month = new Date().toISOString().substring(0, 7);
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'monthly', score_value: u.coins_monthly, period_label: month }))
    );
  }
  await sb.from('users').update({ coins_monthly: 0 }).gt('coins_monthly', 0);
  await sb.from('users').update({ tokens_monthly: 0 }).gt('tokens_monthly', 0);
}

// ─── UTILS ────────────────────────────────────────────────────

export function calcLevel(xp) {
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)) + 1);
}

export function xpForLevel(level) {
  return (level - 1) ** 2 * 100;
}

export function xpForNextLevel(level) {
  return level ** 2 * 100;
}

export function getWeekLabel() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isMaintenanceTime() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  return (h === 1 && m >= 30) || (h === 2 && m === 0);
}

// Upload de imagem como base64 (compatível com GitHub Pages sem backend)
export async function uploadProofImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('Imagem muito grande! Máximo: 2MB'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // base64 data URL
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
