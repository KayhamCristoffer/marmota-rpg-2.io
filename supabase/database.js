// ============================================================
// SUPABASE DATABASE LAYER v2 - RPG Quests
// Corrigido: FK constraints, RLS, profile update, achievements,
//            ranking tokens/coins, auto-user, getAllAchievements
// ============================================================
import { sb, getCurrentUser } from './client.js';
import { ADMIN_UID } from './supabase-config.js';

// ─── AUTH ─────────────────────────────────────────────────────

export async function signUp(email, password, nickname) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  const user = data.user;
  if (!user) throw new Error('Cadastro criado. Verifique seu e-mail para confirmar a conta.');

  // O trigger handle_new_user() já cria o perfil automaticamente.
  // Tentamos upsert para garantir o nickname customizado escolhido na tela.
  // Se o trigger já inseriu, fazemos UPDATE; caso contrário INSERT.
  const { error: upErr } = await sb.from('users').upsert({
    id:               user.id,
    email,
    nickname,
    username:         nickname,
    profile_nickname: nickname,
    role:             'user',
    profile_role:     'Marmotinha',
    level:            1,
    xp:               0,
    coins:            0,
    tokens:           0
  }, { onConflict: 'id' });

  // Ignora erro de unicidade do nickname (trigger pode ter gerado outro)
  if (upErr && !upErr.message?.includes('unique') && !upErr.message?.includes('duplicate')) {
    console.warn('signUp profile upsert warning:', upErr.message);
  }

  return data;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;

  // Garante que o perfil existe (caso o trigger não tenha rodado)
  if (data.user) {
    const { data: existing } = await sb.from('users').select('id').eq('id', data.user.id).maybeSingle();
    if (!existing) {
      const base = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
      await sb.from('users').upsert({
        id: data.user.id, email, nickname: base,
        username: base, profile_nickname: base,
        role: 'user', profile_role: 'Marmotinha',
        level: 1, xp: 0, coins: 0, tokens: 0
      }, { onConflict: 'id', ignoreDuplicates: true });
    }
  }
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
  // Não usa .single() para evitar "Cannot coerce to single JSON object"
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
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createQuest(questData) {
  const { data, error } = await sb
    .from('quests').insert(questData).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function updateQuest(questId, updates) {
  const { data, error } = await sb
    .from('quests').update(updates).eq('id', questId).select();
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

// ─── SUBMISSIONS ──────────────────────────────────────────────

export async function createSubmission(userId, questId, proofUrl) {
  // Primeiro garante que o perfil existe (evita FK violation)
  const { data: userRow } = await sb.from('users').select('id').eq('id', userId).maybeSingle();
  if (!userRow) throw new Error('Perfil não encontrado. Faça logout e login novamente.');

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
    user_id:  userId,
    quest_id: questId,
    proof_url: proofUrl,
    status:   'pending'
  }).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getUserSubmissions(userId) {
  const { data, error } = await sb
    .from('submissions')
    .select(`*, quests(title, type, reward_coins, reward_xp, icon_url)`)
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPendingSubmissions() {
  const { data, error } = await sb
    .from('submissions')
    .select(`*, users(nickname, icon_url, profile_nickname), quests(title, type, reward_coins, reward_xp)`)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function approveSubmission(submissionId) {
  const { data: sub, error: subErr } = await sb
    .from('submissions')
    .select(`*, quests(reward_coins, reward_xp), users(coins, xp, level, coins_daily, coins_weekly, coins_monthly, tokens, tokens_daily, tokens_weekly, tokens_monthly)`)
    .eq('id', submissionId)
    .single();
  if (subErr) throw subErr;

  const reward_coins = sub.quests?.reward_coins || 0;
  const reward_xp    = sub.quests?.reward_xp    || 0;
  const user         = sub.users;

  const newXp    = (user.xp    || 0) + reward_xp;
  const newCoins = (user.coins || 0) + reward_coins;
  const newLevel = calcLevel(newXp);

  await sb.from('users').update({
    coins:         newCoins,
    xp:            newXp,
    level:         newLevel,
    coins_daily:   (user.coins_daily   || 0) + reward_coins,
    coins_weekly:  (user.coins_weekly  || 0) + reward_coins,
    coins_monthly: (user.coins_monthly || 0) + reward_coins,
    updated_at:    new Date().toISOString()
  }).eq('id', sub.user_id);

  const { data, error } = await sb.from('submissions')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
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

// ─── MAPS ─────────────────────────────────────────────────────

export async function getAllMaps() {
  const { data, error } = await sb
    .from('maps').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createMap(mapData) {
  const { data, error } = await sb
    .from('maps').insert(mapData).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function updateMap(mapId, updates) {
  const { data, error } = await sb
    .from('maps').update(updates).eq('id', mapId).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function deleteMap(mapId) {
  const { error } = await sb.from('maps').delete().eq('id', mapId);
  if (error) throw error;
}

export async function likeMap(mapId) {
  const { error } = await sb.rpc('increment_map_likes', { map_id: mapId });
  if (error) throw error;
}

export async function createMapSubmission(userId, mapId, proofUrl) {
  const { data: userRow } = await sb.from('users').select('id').eq('id', userId).maybeSingle();
  if (!userRow) throw new Error('Perfil não encontrado. Faça logout e login novamente.');

  const { data: existing } = await sb
    .from('submissions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('map_id', mapId)
    .in('status', ['pending', 'approved'])
    .maybeSingle();

  if (existing) throw new Error('Você já enviou este mapa!');

  const { data, error } = await sb.from('submissions').insert({
    user_id:   userId,
    map_id:    mapId,
    proof_url: proofUrl,
    status:    'pending'
  }).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

// ─── RANKING ──────────────────────────────────────────────────

// type: 'total' | 'daily' | 'weekly' | 'monthly'
// metric: 'coins' | 'tokens'
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
  return (data ?? []).map(u => ({
    ...u,
    displayName: u.profile_nickname || u.nickname,
    score: u[field] || 0
  }));
}

export function subscribeRanking(type, metric, callback) {
  const channel = sb
    .channel(`ranking-${type}-${metric}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => {
      const data = await getRanking(type, metric);
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
  return data ?? [];
}

export async function createAchievement(achievementData) {
  const { data, error } = await sb
    .from('achievements').insert(achievementData).select();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function updateAchievement(id, updates) {
  const { data, error } = await sb
    .from('achievements').update(updates).eq('id', id).select();
  if (error) throw error;
  return data?.[0] ?? null;
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
  return data ?? [];
}

export async function checkAndGrantAchievements(userId) {
  try {
    const { count: questCount } = await sb
      .from('submissions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'approved')
      .not('quest_id', 'is', null);

    const { data: user }   = await sb.from('users').select('level').eq('id', userId).maybeSingle();
    const { data: badges } = await sb.from('user_badges').select('achievement_id').eq('user_id', userId);
    const earnedIds        = new Set((badges || []).map(b => b.achievement_id));
    const achievements     = await getAllAchievements();  // corrigido: era const { data: achievements }

    for (const ach of achievements) {
      if (earnedIds.has(ach.id)) continue;
      const meetsLevel  = !ach.level_required  || (user?.level  || 1) >= ach.level_required;
      const meetsQuests = !ach.quests_required || (questCount   || 0) >= ach.quests_required;
      if (meetsLevel && meetsQuests) {
        await sb.from('user_badges').upsert(
          { user_id: userId, achievement_id: ach.id },
          { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
        );
        if (ach.reward_coins > 0 || ach.reward_xp > 0) {
          const { data: u } = await sb.from('users').select('coins, xp').eq('id', userId).maybeSingle();
          if (u) await sb.from('users').update({
            coins: (u.coins || 0) + (ach.reward_coins || 0),
            xp:    (u.xp    || 0) + (ach.reward_xp    || 0)
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
  const { data: users } = await sb.from('users').select('id, coins_daily').gt('coins_daily', 0);
  if (users?.length) {
    const today = new Date().toISOString().split('T')[0];
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'daily', score_value: u.coins_daily, period_label: today }))
    );
  }
  await sb.from('users').update({ coins_daily: 0, tokens_daily: 0 }).gte('coins_daily', 0);
}

export async function resetWeeklyRanking() {
  const { data: users } = await sb.from('users').select('id, coins_weekly').gt('coins_weekly', 0);
  if (users?.length) {
    const week = getWeekLabel();
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'weekly', score_value: u.coins_weekly, period_label: week }))
    );
  }
  await sb.from('users').update({ coins_weekly: 0, tokens_weekly: 0 }).gte('coins_weekly', 0);
}

export async function resetMonthlyRanking() {
  const { data: users } = await sb.from('users').select('id, coins_monthly').gt('coins_monthly', 0);
  if (users?.length) {
    const month = new Date().toISOString().substring(0, 7);
    await sb.from('ranking_history').insert(
      users.map(u => ({ user_id: u.id, score_type: 'monthly', score_value: u.coins_monthly, period_label: month }))
    );
  }
  await sb.from('users').update({ coins_monthly: 0, tokens_monthly: 0 }).gte('coins_monthly', 0);
}

// ─── UTILS ────────────────────────────────────────────────────

export function calcLevel(xp) {
  return Math.max(1, Math.floor(Math.sqrt((xp || 0) / 100)) + 1);
}

export function xpForLevel(level) {
  return (level - 1) ** 2 * 100;
}

export function xpForNextLevel(level) {
  return level ** 2 * 100;
}

export function getWeekLabel() {
  const d    = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isMaintenanceTime() {
  const h = new Date().getHours();
  const m = new Date().getMinutes();
  return (h === 1 && m >= 30) || (h === 2 && m === 0);
}

// Upload de prova como base64 data URL (sem backend — GitHub Pages)
export async function uploadProofImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('Nenhum arquivo selecionado')); return; }
    if (file.size > 2 * 1024 * 1024) { reject(new Error('Imagem muito grande! Máximo: 2MB')); return; }
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) { reject(new Error('Formato inválido. Use JPG, PNG, GIF ou WEBP.')); return; }
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo'));
    reader.readAsDataURL(file);
  });
}
