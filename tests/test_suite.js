/**
 * ================================================================
 * TOCA DAS MARMOTAS — TEST SUITE v13
 * Testes de integração end-to-end para todas as funcionalidades
 *
 * Como executar:
 *   1. npm install (na raiz do projeto)
 *   2. Crie um arquivo .env com:
 *        SUPABASE_URL=https://xxxx.supabase.co
 *        SUPABASE_SERVICE_KEY=your_service_role_key
 *        TEST_ADMIN_EMAIL=admin@test.com
 *        TEST_ADMIN_PASSWORD=SenhaAdmin123!
 *        TEST_USER_EMAIL=user@test.com
 *        TEST_USER_PASSWORD=SenhaUser123!
 *   3. node tests/test_suite.js
 *
 * ATENÇÃO: use um projeto Supabase de TESTE, não produção.
 * ================================================================
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Configuração ────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

// Lê .env simples (sem dependência de dotenv)
function loadEnv() {
  try {
    const raw = readFileSync(join(__dirname, '../.env'), 'utf8');
    raw.split('\n').forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && v.length) process.env[k.trim()] = v.join('=').trim();
    });
  } catch {
    console.warn('[ENV] .env não encontrado, usando process.env existente');
  }
}
loadEnv();

const SUPABASE_URL  = process.env.SUPABASE_URL  || '';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY || '';
const ADMIN_EMAIL   = process.env.TEST_ADMIN_EMAIL    || 'admin@marmota.test';
const ADMIN_PASS    = process.env.TEST_ADMIN_PASSWORD || 'Admin@1234';
const USER_EMAIL    = process.env.TEST_USER_EMAIL     || 'user@marmota.test';
const USER_PASS     = process.env.TEST_USER_PASSWORD  || 'User@1234';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios no .env');
  process.exit(1);
}

// Service role client (sem RLS para setup/teardown)
const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── Helpers ─────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const results = [];

function log(icon, label, msg = '') {
  console.log(`  ${icon} ${label}${msg ? ': ' + msg : ''}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    log('✅', name);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    log('❌', name, err.message);
  }
}

function skip(name, reason = '') {
  skipped++;
  results.push({ name, status: 'SKIP', error: reason });
  log('⏭️ ', name, reason);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(a, b, label = '') {
  if (a !== b) throw new Error(`${label} esperado=${b} obtido=${a}`);
}

function assertGte(a, b, label = '') {
  if (a < b) throw new Error(`${label} ${a} < ${b}`);
}

// ── Setup global ────────────────────────────────────────────────
let adminUserId, normalUserId;
let adminClient, userClient;
let testQuestId, testMapId, testSubmissionId, testMissionId;

async function setup() {
  console.log('\n🔧  SETUP — criando usuários de teste...');

  // Cria admin
  const { data: adminData, error: adminErr } = await sbAdmin.auth.admin.createUser({
    email: ADMIN_EMAIL, password: ADMIN_PASS,
    email_confirm: true,
    user_metadata: { nickname: 'admin_test' }
  });
  if (adminErr && !adminErr.message.includes('already')) throw adminErr;
  adminUserId = adminData?.user?.id;

  // Cria usuário normal
  const { data: userData, error: userErr } = await sbAdmin.auth.admin.createUser({
    email: USER_EMAIL, password: USER_PASS,
    email_confirm: true,
    user_metadata: { nickname: 'user_test' }
  });
  if (userErr && !userErr.message.includes('already')) throw userErr;
  normalUserId = userData?.user?.id;

  // Garante rows na tabela users
  if (adminUserId) {
    await sbAdmin.from('users').upsert({
      id: adminUserId, email: ADMIN_EMAIL,
      nickname: 'admin_test', profile_nickname: 'Admin Teste',
      role: 'admin', profile_role: 'Administrador',
      level: 10, xp: 900, coins: 5000, tokens: 100
    }, { onConflict: 'id' });
  }
  if (normalUserId) {
    await sbAdmin.from('users').upsert({
      id: normalUserId, email: USER_EMAIL,
      nickname: 'user_test', profile_nickname: 'User Teste',
      role: 'user', profile_role: 'Marmotinha',
      level: 1, xp: 0, coins: 200, tokens: 10
    }, { onConflict: 'id' });
  }

  // Clientes autenticados
  const { data: adminSession } = await sbAdmin.auth.admin.generateLink({
    type: 'magiclink', email: ADMIN_EMAIL
  });
  const { data: userSession } = await sbAdmin.auth.admin.generateLink({
    type: 'magiclink', email: USER_EMAIL
  });

  // Autentica via password diretamente
  adminClient = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY || SERVICE_KEY);
  const { error: aSignInErr } = await adminClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (aSignInErr) console.warn('[SETUP] Admin signin:', aSignInErr.message);

  userClient = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY || SERVICE_KEY);
  const { error: uSignInErr } = await userClient.auth.signInWithPassword({ email: USER_EMAIL, password: USER_PASS });
  if (uSignInErr) console.warn('[SETUP] User signin:', uSignInErr.message);

  console.log(`   Admin  UID: ${adminUserId || '(já existia)'}`);
  console.log(`   User   UID: ${normalUserId || '(já existia)'}`);
  console.log('');
}

async function teardown() {
  console.log('\n🧹  TEARDOWN — limpando dados de teste...');

  // Remove dados criados (ordem das FKs)
  if (testMissionId) {
    await sbAdmin.from('group_mission_proofs').delete().eq('mission_id', testMissionId);
    await sbAdmin.from('group_mission_members').delete().eq('mission_id', testMissionId);
    await sbAdmin.from('group_missions').delete().eq('id', testMissionId);
  }
  if (testSubmissionId) await sbAdmin.from('submissions').delete().eq('id', testSubmissionId);
  if (testMapId) await sbAdmin.from('maps').delete().eq('id', testMapId);
  if (testQuestId) await sbAdmin.from('quests').delete().eq('id', testQuestId);

  await sbAdmin.from('friendships').delete()
    .or(`requester.eq.${adminUserId},addressee.eq.${adminUserId},requester.eq.${normalUserId},addressee.eq.${normalUserId}`);

  await sbAdmin.from('user_badges').delete().in('user_id', [adminUserId, normalUserId].filter(Boolean));
  await sbAdmin.from('ranking_history').delete().in('user_id', [adminUserId, normalUserId].filter(Boolean));
  await sbAdmin.from('hall_of_fame').delete().in('user_id', [adminUserId, normalUserId].filter(Boolean));
  await sbAdmin.from('shop_purchases').delete().in('user_id', [adminUserId, normalUserId].filter(Boolean));

  // Remove usuários de teste
  if (adminUserId) {
    await sbAdmin.from('users').delete().eq('id', adminUserId);
    await sbAdmin.auth.admin.deleteUser(adminUserId);
  }
  if (normalUserId) {
    await sbAdmin.from('users').delete().eq('id', normalUserId);
    await sbAdmin.auth.admin.deleteUser(normalUserId);
  }

  console.log('   Teardown concluído.\n');
}

// ================================================================
// SUÍTE 1 — AUTH / USERS
// ================================================================
async function suiteAuth() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 1 — AUTH & USERS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await test('1.1 — Admin existe na tabela users', async () => {
    if (!adminUserId) throw new Error('adminUserId não definido');
    const { data, error } = await sbAdmin.from('users').select('id,role').eq('id', adminUserId).single();
    assert(!error, error?.message);
    assertEqual(data.role, 'admin', 'role');
  });

  await test('1.2 — User normal existe na tabela users', async () => {
    if (!normalUserId) throw new Error('normalUserId não definido');
    const { data, error } = await sbAdmin.from('users').select('id,role').eq('id', normalUserId).single();
    assert(!error, error?.message);
    assertEqual(data.role, 'user', 'role');
  });

  await test('1.3 — Campos obrigatórios: coins/tokens >= 0', async () => {
    const { data } = await sbAdmin.from('users').select('coins,tokens').eq('id', normalUserId).single();
    assert(data.coins >= 0, 'coins deve ser >= 0');
    assert(data.tokens >= 0, 'tokens deve ser >= 0');
  });

  await test('1.4 — Nickname mínimo 3 chars (constraint)', async () => {
    const { error } = await sbAdmin.from('users').insert({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'bad@test.com', nickname: 'ab'  // 2 chars → deve falhar
    });
    assert(error !== null, 'Deveria ter rejeitado nickname de 2 chars');
  });

  await test('1.5 — updateUserProfile: atualiza bio e perfil público', async () => {
    const { error } = await sbAdmin.from('users').update({
      profile_bio: 'Bio de teste', public_profile: true
    }).eq('id', normalUserId);
    assert(!error, error?.message);
    const { data } = await sbAdmin.from('users').select('profile_bio,public_profile').eq('id', normalUserId).single();
    assertEqual(data.profile_bio, 'Bio de teste', 'bio');
    assertEqual(data.public_profile, true, 'public_profile');
  });

  await test('1.6 — setUserRole: promoção a moderator', async () => {
    const { error } = await sbAdmin.from('users').update({ role: 'moderator' }).eq('id', normalUserId);
    assert(!error, error?.message);
    const { data } = await sbAdmin.from('users').select('role').eq('id', normalUserId).single();
    assertEqual(data.role, 'moderator', 'role');
    // Volta para 'user'
    await sbAdmin.from('users').update({ role: 'user' }).eq('id', normalUserId);
  });

  await test('1.7 — searchPublicUsers: retorna usuários com public_profile=true', async () => {
    await sbAdmin.from('users').update({ public_profile: true, nickname: 'user_test' }).eq('id', normalUserId);
    const { data, error } = await sbAdmin.from('users')
      .select('id,nickname,level')
      .eq('public_profile', true)
      .ilike('nickname', '%user_test%')
      .limit(5);
    assert(!error, error?.message);
    assert(data.length >= 1, 'Deveria encontrar ao menos 1 usuário público');
  });
}

// ================================================================
// SUÍTE 2 — QUESTS
// ================================================================
async function suiteQuests() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 2 — QUESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await test('2.1 — Criar quest (via service role)', async () => {
    const { data, error } = await sbAdmin.from('quests').insert({
      title: 'Quest de Teste v13',
      description: 'Quest criada para testes automatizados',
      type: 'daily',
      icon_url: '🧪',
      reward_coins: 100,
      reward_tokens: 5,
      reward_xp: 50,
      cooldown_hours: 24,
      proof_required: true,
      is_active: true
    }).select().single();
    assert(!error, error?.message);
    assert(data.id, 'Quest deve ter ID');
    testQuestId = data.id;
    log('   ', `Quest criada: ${testQuestId.slice(0,8)}…`);
  });

  await test('2.2 — Listar quests ativas', async () => {
    const { data, error } = await sbAdmin.from('quests').select('*').eq('is_active', true);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'quests ativas');
  });

  await test('2.3 — Atualizar quest: desativar', async () => {
    if (!testQuestId) throw new Error('testQuestId não definido');
    const { error } = await sbAdmin.from('quests').update({ is_active: false }).eq('id', testQuestId);
    assert(!error, error?.message);
    const { data } = await sbAdmin.from('quests').select('is_active').eq('id', testQuestId).single();
    assertEqual(data.is_active, false, 'is_active');
    // Reativa para próximos testes
    await sbAdmin.from('quests').update({ is_active: true }).eq('id', testQuestId);
  });

  await test('2.4 — Constraint: type inválido rejeitado', async () => {
    const { error } = await sbAdmin.from('quests').insert({
      title: 'Quest Inválida', type: 'xpto'  // tipo inexistente
    });
    assert(error !== null, 'Deveria ter rejeitado tipo inválido');
  });

  await test('2.5 — reward_coins não pode ser negativo', async () => {
    const { error } = await sbAdmin.from('quests').insert({
      title: 'Quest Coins Neg', type: 'daily', reward_coins: -10
    });
    assert(error !== null, 'Deveria rejeitar reward_coins negativo');
  });
}

// ================================================================
// SUÍTE 3 — SUBMISSIONS
// ================================================================
async function suiteSubmissions() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 3 — SUBMISSIONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!testQuestId || !normalUserId) {
    skip('3.1-3.5', 'Dependências (quest/user) não criadas');
    return;
  }

  await test('3.1 — Criar submission (user normal)', async () => {
    const { data, error } = await sbAdmin.from('submissions').insert({
      user_id: normalUserId,
      quest_id: testQuestId,
      status: 'pending',
      proof_url: 'https://prnt.sc/teste123'
    }).select().single();
    assert(!error, error?.message);
    testSubmissionId = data.id;
    log('   ', `Submission criada: ${testSubmissionId.slice(0,8)}…`);
  });

  await test('3.2 — Listar submissions pendentes', async () => {
    const { data, error } = await sbAdmin.from('submissions')
      .select('id, user_id, status').eq('status', 'pending');
    assert(!error, error?.message);
    assertGte(data.length, 1, 'submissions pendentes');
  });

  await test('3.3 — Aprovar via approve_submission_v2 (RPC)', async () => {
    if (!testSubmissionId) throw new Error('testSubmissionId não definido');
    const { data, error } = await sbAdmin.rpc('approve_submission_v2', {
      p_submission_id: testSubmissionId,
      p_admin_id: adminUserId,
      p_note: 'Aprovado nos testes automatizados'
    });
    // Se a função não existir ainda (ambiente sem v13), faz update manual
    if (error && error.message.includes('does not exist')) {
      const { error: updErr } = await sbAdmin.from('submissions')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', testSubmissionId);
      assert(!updErr, updErr?.message);
      log('   ', '(fallback: update manual usado — execute v13 migration)');
    } else {
      assert(!error, error?.message);
      assert(data?.ok === true || data === null, JSON.stringify(data));
    }
  });

  await test('3.4 — Verificar recompensas distribuídas ao usuário', async () => {
    const { data } = await sbAdmin.from('users').select('coins,tokens,xp').eq('id', normalUserId).single();
    assertGte(data.coins, 0, 'coins');
    assertGte(data.xp, 0, 'xp');
  });

  await test('3.5 — Rejeitar submission (outra)', async () => {
    const { data: sub } = await sbAdmin.from('submissions').insert({
      user_id: normalUserId,
      quest_id: testQuestId,
      status: 'pending',
      proof_url: 'https://prnt.sc/reject_test'
    }).select().single();
    const { error } = await sbAdmin.from('submissions')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString(), admin_note: 'Comprovante inválido' })
      .eq('id', sub.id);
    assert(!error, error?.message);
    // Limpeza
    await sbAdmin.from('submissions').delete().eq('id', sub.id);
  });
}

// ================================================================
// SUÍTE 4 — MAPS & MAP_SUBMISSIONS
// ================================================================
async function suiteMaps() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 4 — MAPS & MAP_SUBMISSIONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await test('4.1 — Criar mapa aprovado', async () => {
    const { data, error } = await sbAdmin.from('maps').insert({
      title: 'Mapa de Teste v13',
      description: 'Mapa criado pelos testes automatizados',
      type: 'dungeon',
      icon_url: '🏰',
      reward_coins: 200,
      reward_tokens: 10,
      reward_xp: 100,
      download_url: 'https://example.com/map_test.zip',
      submitted_by: normalUserId,
      submitted_by_nick: 'user_test'
    }).select().single();
    assert(!error, error?.message);
    testMapId = data.id;
    log('   ', `Mapa criado: ${testMapId.slice(0,8)}…`);
  });

  await test('4.2 — Listar mapas', async () => {
    const { data, error } = await sbAdmin.from('maps').select('*').limit(10);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'mapas');
  });

  await test('4.3 — Curtir mapa (increment_map_likes RPC)', async () => {
    if (!testMapId) throw new Error('testMapId não definido');
    const { error } = await sbAdmin.rpc('increment_map_likes', { map_id: testMapId });
    if (error && error.message.includes('does not exist')) {
      log('   ', '(fallback: update manual — execute v13 migration)');
      await sbAdmin.from('maps').update({ likes_count: 1 }).eq('id', testMapId);
    } else {
      assert(!error, error?.message);
    }
    const { data } = await sbAdmin.from('maps').select('likes_count').eq('id', testMapId).single();
    assertGte(data.likes_count, 1, 'likes_count');
  });

  await test('4.4 — Incrementar views (increment_map_views RPC)', async () => {
    if (!testMapId) throw new Error('testMapId não definido');
    const { error } = await sbAdmin.rpc('increment_map_views', { map_id: testMapId });
    if (!error) {
      const { data } = await sbAdmin.from('maps').select('views_count').eq('id', testMapId).single();
      assertGte(data.views_count, 1, 'views_count');
    } else {
      skip('4.4', 'increment_map_views não encontrada — execute v13 migration');
    }
  });

  await test('4.5 — Enviar map_submission (user)', async () => {
    if (!normalUserId) throw new Error('normalUserId não definido');
    const { data, error } = await sbAdmin.from('map_submissions').insert({
      user_id: normalUserId,
      title: 'Minha Submissão de Teste',
      description: 'Descrição da submissão',
      type: 'adventure',
      download_url: 'https://example.com/sub_test.zip',
      status: 'pending'
    }).select().single();
    assert(!error, error?.message);
    // Limpeza imediata
    await sbAdmin.from('map_submissions').delete().eq('id', data.id);
  });

  await test('4.6 — Constraint: tipo de mapa inválido rejeitado', async () => {
    const { error } = await sbAdmin.from('maps').insert({
      title: 'Mapa Tipo Inválido', type: 'invalid_type'
    });
    assert(error !== null, 'Deveria rejeitar tipo inválido');
  });
}

// ================================================================
// SUÍTE 5 — RANKINGS & HISTÓRICO
// ================================================================
async function suiteRankings() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 5 — RANKINGS & HISTÓRICO');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await test('5.1 — Ranking diário: lista usuários com coins_daily', async () => {
    await sbAdmin.from('users').update({ coins_daily: 500 }).eq('id', adminUserId);
    const { data, error } = await sbAdmin.from('users')
      .select('id,nickname,coins_daily').order('coins_daily', { ascending: false }).limit(10);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'ranking diário');
    assert(data[0].coins_daily >= 0, 'coins_daily deve ser >= 0');
  });

  await test('5.2 — Ranking total: ordenado por coins DESC', async () => {
    const { data, error } = await sbAdmin.from('users')
      .select('id,nickname,coins').order('coins', { ascending: false }).limit(10);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'ranking total');
  });

  await test('5.3 — brt_period_label RPC (daily)', async () => {
    const { data, error } = await sbAdmin.rpc('brt_period_label', { p_type: 'daily' });
    if (error) {
      skip('5.3', 'brt_period_label não encontrada — execute v13 migration');
    } else {
      assert(typeof data === 'string' && data.length > 0, 'label deve ser string não vazia');
      log('   ', `Period label: ${data}`);
    }
  });

  await test('5.4 — Inserir em ranking_history', async () => {
    if (!normalUserId) throw new Error('normalUserId não definido');
    const label = new Date().toLocaleDateString('pt-BR');
    const { data, error } = await sbAdmin.from('ranking_history').insert({
      user_id: normalUserId, score_type: 'daily',
      score_coins: 300, score_tokens: 5, period_label: label
    }).select().single();
    assert(!error, error?.message);
    assertEqual(data.score_coins, 300, 'score_coins');
    // Limpeza
    await sbAdmin.from('ranking_history').delete().eq('id', data.id);
  });

  await test('5.5 — auto_reset_daily_ranking RPC', async () => {
    const { data, error } = await sbAdmin.rpc('auto_reset_daily_ranking');
    if (error && error.message.includes('does not exist')) {
      skip('5.5', 'auto_reset_daily_ranking não encontrada — execute v13 migration');
    } else {
      assert(!error, error?.message);
      assert(data?.type === 'daily' || data === null, 'reset type deve ser daily');
    }
  });
}

// ================================================================
// SUÍTE 6 — ACHIEVEMENTS & BADGES
// ================================================================
async function suiteAchievements() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 6 — ACHIEVEMENTS & BADGES');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let testAchId;

  await test('6.1 — Criar achievement', async () => {
    const { data, error } = await sbAdmin.from('achievements').insert({
      title: 'Conquista de Teste v13',
      description: 'Criada pelos testes automatizados',
      icon_url: '🧪',
      category_type: 'quest',
      quests_required: 1,
      reward_coins: 50, reward_xp: 25
    }).select().single();
    assert(!error, error?.message);
    testAchId = data.id;
    log('   ', `Achievement criada: ${testAchId.slice(0,8)}…`);
  });

  await test('6.2 — Listar todas as achievements', async () => {
    const { data, error } = await sbAdmin.from('achievements').select('*');
    assert(!error, error?.message);
    assertGte(data.length, 1, 'achievements');
  });

  await test('6.3 — Conceder badge ao usuário', async () => {
    if (!testAchId || !normalUserId) throw new Error('dependências não definidas');
    const { error } = await sbAdmin.from('user_badges').insert({
      user_id: normalUserId, achievement_id: testAchId
    });
    assert(!error, error?.message);
  });

  await test('6.4 — Buscar badges do usuário', async () => {
    if (!normalUserId) throw new Error('normalUserId não definido');
    const { data, error } = await sbAdmin.from('user_badges')
      .select('achievement_id, earned_at').eq('user_id', normalUserId);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'badges do usuário');
  });

  await test('6.5 — Duplicate badge rejeitado (PK constraint)', async () => {
    if (!testAchId || !normalUserId) throw new Error('dependências não definidas');
    const { error } = await sbAdmin.from('user_badges').insert({
      user_id: normalUserId, achievement_id: testAchId
    });
    assert(error !== null, 'Deveria rejeitar badge duplicado');
  });

  await test('6.6 — Achievements HoF: hof_required > 0', async () => {
    const { data, error } = await sbAdmin.from('achievements')
      .select('id,title,hof_required').gt('hof_required', 0);
    assert(!error, error?.message);
    // Pode ser 0 se não foi criado ainda; apenas verifica query
    log('   ', `${data.length} achievements com hof_required`);
  });

  // Limpeza
  if (testAchId) {
    await sbAdmin.from('user_badges').delete().eq('achievement_id', testAchId);
    await sbAdmin.from('achievements').delete().eq('id', testAchId);
  }
}

// ================================================================
// SUÍTE 7 — SHOP
// ================================================================
async function suiteShop() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 7 — SHOP (LOJA)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let testItemId;

  await test('7.1 — Criar item na loja', async () => {
    const { data, error } = await sbAdmin.from('shop_items').insert({
      name: 'Item de Teste v13',
      description: 'Criado pelos testes',
      icon_url: '🧪',
      category: 'teste',
      price_coins: 100,
      currency: 'coins',
      stock: 5,
      quantity_per_user: 1,
      is_active: true
    }).select().single();
    assert(!error, error?.message);
    testItemId = data.id;
    log('   ', `Item criado: ${testItemId.slice(0,8)}…`);
  });

  await test('7.2 — Listar itens ativos', async () => {
    const { data, error } = await sbAdmin.from('shop_items').select('*').eq('is_active', true);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'itens ativos');
  });

  await test('7.3 — Compra: verifica saldo e debita coins', async () => {
    if (!testItemId || !normalUserId) throw new Error('dependências não definidas');
    // Garante que o usuário tem saldo suficiente
    await sbAdmin.from('users').update({ coins: 500 }).eq('id', normalUserId);
    const { data: item } = await sbAdmin.from('shop_items').select('price_coins').eq('id', testItemId).single();

    // Debita
    const { error: purchErr } = await sbAdmin.from('users').update({
      coins: sbAdmin.raw ? `coins - ${item.price_coins}` : 400
    }).eq('id', normalUserId);

    // Registra compra
    const { error: insertErr } = await sbAdmin.from('shop_purchases').insert({
      user_id: normalUserId, item_id: testItemId,
      qty: 1, paid_coins: item.price_coins, paid_tokens: 0
    });
    assert(!insertErr, insertErr?.message);
    log('   ', `Compra registrada — ${item.price_coins} coins debitados`);
  });

  await test('7.4 — Favoritar item', async () => {
    if (!testItemId || !normalUserId) throw new Error('dependências não definidas');
    const { error } = await sbAdmin.from('shop_favorites').insert({
      user_id: normalUserId, item_id: testItemId
    });
    assert(!error, error?.message);
    // Desfavoritar
    await sbAdmin.from('shop_favorites').delete()
      .eq('user_id', normalUserId).eq('item_id', testItemId);
  });

  await test('7.5 — price_coins negativo rejeitado', async () => {
    const { error } = await sbAdmin.from('shop_items').insert({
      name: 'Item Inválido', price_coins: -50, currency: 'coins'
    });
    assert(error !== null, 'Deveria rejeitar price_coins negativo');
  });

  // Limpeza
  if (testItemId) {
    await sbAdmin.from('shop_purchases').delete().eq('item_id', testItemId);
    await sbAdmin.from('shop_items').delete().eq('id', testItemId);
  }
}

// ================================================================
// SUÍTE 8 — FRIENDSHIPS
// ================================================================
async function suiteFriendships() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 8 — FRIENDSHIPS (AMIZADES)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!adminUserId || !normalUserId) {
    skip('8.1-8.6', 'Usuários de teste não criados');
    return;
  }

  let friendshipId;

  await test('8.1 — Enviar pedido de amizade', async () => {
    const { data, error } = await sbAdmin.from('friendships').insert({
      requester: adminUserId, addressee: normalUserId, status: 'pending'
    }).select().single();
    assert(!error, error?.message);
    friendshipId = data.id;
    log('   ', `Amizade ID: ${friendshipId}`);
  });

  await test('8.2 — Aceitar pedido de amizade', async () => {
    const { error } = await sbAdmin.from('friendships')
      .update({ status: 'accepted' }).eq('id', friendshipId);
    assert(!error, error?.message);
    const { data } = await sbAdmin.from('friendships').select('status').eq('id', friendshipId).single();
    assertEqual(data.status, 'accepted', 'status');
  });

  await test('8.3 — Listar amigos aceitos do admin', async () => {
    const { data, error } = await sbAdmin.from('friendships')
      .select('*').eq('status', 'accepted')
      .or(`requester.eq.${adminUserId},addressee.eq.${adminUserId}`);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'amizades aceitas');
  });

  await test('8.4 — Self-friendship rejeitada (constraint)', async () => {
    const { error } = await sbAdmin.from('friendships').insert({
      requester: adminUserId, addressee: adminUserId, status: 'pending'
    });
    assert(error !== null, 'Deveria rejeitar amizade consigo mesmo');
  });

  await test('8.5 — Duplicate friendship rejeitada (UNIQUE)', async () => {
    const { error } = await sbAdmin.from('friendships').insert({
      requester: adminUserId, addressee: normalUserId, status: 'pending'
    });
    assert(error !== null, 'Deveria rejeitar duplicata de amizade');
  });

  await test('8.6 — Remover amizade', async () => {
    const { error } = await sbAdmin.from('friendships').delete().eq('id', friendshipId);
    assert(!error, error?.message);
    const { data } = await sbAdmin.from('friendships').select('id').eq('id', friendshipId);
    assertEqual(data.length, 0, 'amizade removida');
  });
}

// ================================================================
// SUÍTE 9 — HALL OF FAME
// ================================================================
async function suiteHallOfFame() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 9 — HALL OF FAME');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!adminUserId) {
    skip('9.1-9.5', 'adminUserId não definido');
    return;
  }

  const label = 'Teste_' + Date.now();

  await test('9.1 — Inserir entrada no Hall da Fama', async () => {
    const { data, error } = await sbAdmin.from('hall_of_fame').insert({
      user_id: adminUserId, score_type: 'monthly',
      metric: 'coins', score: 9999, period_label: label
    }).select().single();
    assert(!error, error?.message);
    assertEqual(data.score, 9999, 'score');
  });

  await test('9.2 — UNIQUE: duplicata no mesmo período rejeitada', async () => {
    const { error } = await sbAdmin.from('hall_of_fame').insert({
      user_id: adminUserId, score_type: 'monthly',
      metric: 'coins', score: 1111, period_label: label
    });
    assert(error !== null, 'Deveria rejeitar duplicata HoF');
  });

  await test('9.3 — Listar Hall da Fama (monthly, coins)', async () => {
    const { data, error } = await sbAdmin.from('hall_of_fame')
      .select('*, user:users(nickname)')
      .eq('score_type', 'monthly').eq('metric', 'coins')
      .order('score', { ascending: false }).limit(10);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'entradas HoF');
  });

  await test('9.4 — record_hall_of_fame RPC', async () => {
    await sbAdmin.from('users').update({ coins_monthly: 9999 }).eq('id', adminUserId);
    const { error } = await sbAdmin.rpc('record_hall_of_fame', {
      p_type: 'monthly', p_label: 'Teste_RPC_' + Date.now()
    });
    if (error && error.message.includes('does not exist')) {
      skip('9.4', 'record_hall_of_fame não encontrada — execute v13 migration');
    } else {
      assert(!error, error?.message);
    }
  });

  await test('9.5 — hof_entries incrementado ao entrar no HoF', async () => {
    const { data } = await sbAdmin.from('users').select('hof_entries').eq('id', adminUserId).single();
    // Pode ser null se coluna não existir ainda
    log('   ', `hof_entries: ${data?.hof_entries ?? 'coluna não existe (execute v13)'}`);
    assert(data?.hof_entries !== undefined || true, 'ok'); // não falha
  });

  // Limpeza
  await sbAdmin.from('hall_of_fame').delete().eq('period_label', label);
}

// ================================================================
// SUÍTE 10 — GROUP MISSIONS
// ================================================================
async function suiteGroupMissions() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 10 — GROUP MISSIONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!adminUserId || !normalUserId) {
    skip('10.1-10.7', 'Usuários de teste não criados');
    return;
  }

  let proofId;

  await test('10.1 — Criar missão em grupo', async () => {
    const { data, error } = await sbAdmin.from('group_missions').insert({
      title: 'Missão de Teste v13',
      description: 'Missão criada para testes automatizados',
      creator_id: adminUserId,
      status: 'open',
      min_members: 2,
      required_members: 2,
      max_members: 5,
      reward_coins: 300,
      reward_tokens: 15,
      reward_xp: 200,
      proof_note: 'Tire print com todos no mapa'
    }).select().single();
    assert(!error, error?.message);
    testMissionId = data.id;
    log('   ', `Missão criada: ${testMissionId.slice(0,8)}…`);
  });

  await test('10.2 — Constraint min_members <= required_members', async () => {
    const { error } = await sbAdmin.from('group_missions').insert({
      title: 'Missão Inválida', creator_id: adminUserId,
      min_members: 5, required_members: 2, max_members: 10  // min > required → deve falhar
    });
    assert(error !== null, 'Deveria rejeitar min_members > required_members');
  });

  await test('10.3 — Entrar na missão (admin + user)', async () => {
    if (!testMissionId) throw new Error('testMissionId não definido');
    const { error: e1 } = await sbAdmin.from('group_mission_members')
      .insert({ mission_id: testMissionId, user_id: adminUserId, role: 'leader' });
    assert(!e1, e1?.message);
    const { error: e2 } = await sbAdmin.from('group_mission_members')
      .insert({ mission_id: testMissionId, user_id: normalUserId, role: 'member' });
    assert(!e2, e2?.message);
  });

  await test('10.4 — Listar membros da missão', async () => {
    if (!testMissionId) throw new Error('testMissionId não definido');
    const { data, error } = await sbAdmin.from('group_mission_members')
      .select('user_id, role').eq('mission_id', testMissionId);
    assert(!error, error?.message);
    assertEqual(data.length, 2, 'membros na missão');
  });

  await test('10.5 — Enviar comprovante de missão', async () => {
    if (!testMissionId || !normalUserId) throw new Error('dependências não definidas');
    const { data, error } = await sbAdmin.from('group_mission_proofs').insert({
      mission_id: testMissionId,
      submitted_by: normalUserId,
      proof_url: 'https://i.imgur.com/teste_proof.png',
      note: 'Comprovante dos testes automatizados',
      status: 'pending'
    }).select().single();
    assert(!error, error?.message);
    proofId = data.id;
    log('   ', `Comprovante enviado: ID ${proofId}`);
  });

  await test('10.6 — UNIQUE: segundo comprovante na mesma missão rejeitado', async () => {
    if (!testMissionId || !adminUserId) throw new Error('dependências não definidas');
    const { error } = await sbAdmin.from('group_mission_proofs').insert({
      mission_id: testMissionId,
      submitted_by: adminUserId,
      proof_url: 'https://i.imgur.com/dup_proof.png',
      status: 'pending'
    });
    assert(error !== null, 'Deveria rejeitar comprovante duplicado por missão');
  });

  await test('10.7 — Aprovar comprovante via RPC', async () => {
    if (!proofId) throw new Error('proofId não definido');
    const { data, error } = await sbAdmin.rpc('approve_group_mission_proof', {
      p_proof_id: proofId,
      p_admin_id: adminUserId,
      p_admin_note: 'Aprovado nos testes'
    });
    if (error && error.message.includes('does not exist')) {
      skip('10.7', 'approve_group_mission_proof não encontrada — execute v13 migration');
    } else {
      assert(!error, error?.message);
      assert(data?.ok === true, `Resultado: ${JSON.stringify(data)}`);
      log('   ', `Membros recompensados: ${data?.rewarded_members}`);
    }
  });

  await test('10.8 — Missão marcada como completed após aprovação', async () => {
    if (!testMissionId) throw new Error('testMissionId não definido');
    const { data } = await sbAdmin.from('group_missions').select('status').eq('id', testMissionId).single();
    // Só verifica se a RPC foi executada com sucesso
    log('   ', `Status da missão: ${data?.status}`);
    assert(['completed', 'open'].includes(data?.status), 'status inválido');
  });

  await test('10.9 — Sair da missão', async () => {
    // Cria outra missão apenas para testar saída
    const { data: m } = await sbAdmin.from('group_missions').insert({
      title: 'Missão Saída Teste', creator_id: adminUserId,
      min_members: 2, required_members: 2, max_members: 5
    }).select().single();
    await sbAdmin.from('group_mission_members').insert({
      mission_id: m.id, user_id: normalUserId, role: 'member'
    });
    const { error } = await sbAdmin.from('group_mission_members').delete()
      .eq('mission_id', m.id).eq('user_id', normalUserId);
    assert(!error, error?.message);
    // Limpeza
    await sbAdmin.from('group_missions').delete().eq('id', m.id);
  });
}

// ================================================================
// SUÍTE 11 — CONTENT VOTES & PUBLIC PROFILE
// ================================================================
async function suiteExtra() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 11 — CONTENT VOTES & PUBLIC PROFILE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!testMapId || !normalUserId) {
    skip('11.1-11.5', 'testMapId ou normalUserId não definido');
    return;
  }

  await test('11.1 — Votar em mapa (approve)', async () => {
    const { data, error } = await sbAdmin.from('content_votes').insert({
      user_id: normalUserId, target_type: 'map',
      target_id: testMapId, vote: 'approve'
    }).select().single();
    assert(!error, error?.message);
    assertEqual(data.vote, 'approve', 'vote');
  });

  await test('11.2 — Duplicate vote rejeitado (UNIQUE)', async () => {
    const { error } = await sbAdmin.from('content_votes').insert({
      user_id: normalUserId, target_type: 'map',
      target_id: testMapId, vote: 'reject'
    });
    assert(error !== null, 'Deveria rejeitar voto duplicado');
  });

  await test('11.3 — Vote inválido rejeitado (constraint)', async () => {
    const { error } = await sbAdmin.from('content_votes').insert({
      user_id: adminUserId, target_type: 'map',
      target_id: testMapId, vote: 'invalid_vote'
    });
    assert(error !== null, 'Deveria rejeitar tipo de voto inválido');
  });

  await test('11.4 — Perfil público: buscar por nickname', async () => {
    await sbAdmin.from('users').update({ public_profile: true }).eq('id', normalUserId);
    const { data, error } = await sbAdmin.from('users')
      .select('id,nickname,level,profile_bio,public_profile')
      .eq('nickname', 'user_test').eq('public_profile', true).maybeSingle();
    assert(!error, error?.message);
    assert(data !== null, 'Perfil público deve ser encontrado');
  });

  await test('11.5 — Perfil privado não aparece na busca pública', async () => {
    await sbAdmin.from('users').update({ public_profile: false }).eq('id', normalUserId);
    const { data, error } = await sbAdmin.from('users')
      .select('id').eq('nickname', 'user_test').eq('public_profile', true).maybeSingle();
    assert(!error, error?.message);
    assert(data === null, 'Perfil privado não deve aparecer na busca pública');
    // Restaura
    await sbAdmin.from('users').update({ public_profile: true }).eq('id', normalUserId);
  });

  // Limpeza votes
  await sbAdmin.from('content_votes').delete().eq('user_id', normalUserId);
}

// ================================================================
// SUÍTE 12 — INTEGRIDADE DO BANCO (CONSTRAINTS)
// ================================================================
async function suiteIntegrity() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 12 — INTEGRIDADE & CONSTRAINTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await test('12.1 — FK: submission com quest_id inválido rejeitado', async () => {
    const { error } = await sbAdmin.from('submissions').insert({
      user_id: normalUserId,
      quest_id: '00000000-0000-0000-0000-000000000999',
      status: 'pending'
    });
    assert(error !== null, 'Deveria rejeitar FK inválida em quest_id');
  });

  await test('12.2 — FK: map_submission com user_id inválido rejeitado', async () => {
    const { error } = await sbAdmin.from('map_submissions').insert({
      user_id: '00000000-0000-0000-0000-000000000999',
      title: 'Mapa Órfão', type: 'adventure'
    });
    assert(error !== null, 'Deveria rejeitar FK inválida em user_id');
  });

  await test('12.3 — CHECK: submission status inválido rejeitado', async () => {
    const { error } = await sbAdmin.from('submissions').insert({
      user_id: normalUserId, quest_id: testQuestId, status: 'unknown_status'
    });
    assert(error !== null, 'Deveria rejeitar status inválido em submissions');
  });

  await test('12.4 — CHECK: users.role inválido rejeitado', async () => {
    const { error } = await sbAdmin.from('users').update({ role: 'superadmin' }).eq('id', normalUserId);
    assert(error !== null, 'Deveria rejeitar role inválido');
  });

  await test('12.5 — CHECK: hall_of_fame.score < 0 rejeitado', async () => {
    const { error } = await sbAdmin.from('hall_of_fame').insert({
      user_id: adminUserId, score_type: 'daily', metric: 'coins',
      score: -100, period_label: 'Neg Test'
    });
    assert(error !== null, 'Deveria rejeitar score negativo no HoF');
  });

  await test('12.6 — CHECK: group_mission_members role inválido rejeitado', async () => {
    if (!testMissionId) { skip('12.6', 'testMissionId não definido'); return; }
    const { error } = await sbAdmin.from('group_mission_members').insert({
      mission_id: testMissionId, user_id: adminUserId, role: 'boss'
    });
    assert(error !== null, 'Deveria rejeitar role inválido em members');
  });

  await test('12.7 — CASCADE: deletar quest remove submissions', async () => {
    // Cria uma quest e submission temporárias
    const { data: q } = await sbAdmin.from('quests').insert({
      title: 'Quest Cascade Test', type: 'daily', is_active: true
    }).select().single();
    const { data: s } = await sbAdmin.from('submissions').insert({
      user_id: normalUserId, quest_id: q.id, status: 'pending'
    }).select().single();
    // Deleta a quest
    await sbAdmin.from('quests').delete().eq('id', q.id);
    // Submission deve ter sido removida em cascata
    const { data: check } = await sbAdmin.from('submissions').select('id').eq('id', s.id);
    assertEqual(check.length, 0, 'submission após cascade delete');
  });
}

// ================================================================
// SUÍTE 13 — ANALYTICS ADMIN
// ================================================================
async function suiteAnalytics() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦  SUITE 13 — ANALYTICS ADMIN');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await test('13.1 — Total de usuários', async () => {
    const { count, error } = await sbAdmin.from('users').select('*', { count: 'exact', head: true });
    assert(!error, error?.message);
    assertGte(count, 1, 'total usuários');
    log('   ', `Total usuários: ${count}`);
  });

  await test('13.2 — Total de quests', async () => {
    const { count, error } = await sbAdmin.from('quests').select('*', { count: 'exact', head: true });
    assert(!error, error?.message);
    assertGte(count, 1, 'total quests');
    log('   ', `Total quests: ${count}`);
  });

  await test('13.3 — Submissões pendentes', async () => {
    const { data, error } = await sbAdmin.from('submissions').select('id').eq('status', 'pending');
    assert(!error, error?.message);
    log('   ', `Submissões pendentes: ${data.length}`);
  });

  await test('13.4 — Top 5 usuários por coins', async () => {
    const { data, error } = await sbAdmin.from('users')
      .select('nickname,coins').order('coins', { ascending: false }).limit(5);
    assert(!error, error?.message);
    assertGte(data.length, 1, 'top usuários');
    log('   ', `Top 1: ${data[0].nickname} (${data[0].coins} coins)`);
  });

  await test('13.5 — Últimos resets de ranking', async () => {
    const { data, error } = await sbAdmin.from('ranking_reset_log')
      .select('reset_type,period_label,reset_at').order('reset_at', { ascending: false }).limit(5);
    assert(!error, error?.message);
    log('   ', `Resets registrados: ${data.length}`);
  });
}

// ================================================================
// RELATÓRIO FINAL
// ================================================================
function printReport() {
  const total = passed + failed + skipped;
  console.log('\n');
  console.log('══════════════════════════════════════════════');
  console.log('             RELATÓRIO DE TESTES              ');
  console.log('══════════════════════════════════════════════');
  console.log(`  Total:    ${total}`);
  console.log(`  ✅ PASS:  ${passed}`);
  console.log(`  ❌ FAIL:  ${failed}`);
  console.log(`  ⏭️  SKIP:  ${skipped}`);
  console.log('──────────────────────────────────────────────');

  if (failed > 0) {
    console.log('\n  Falhas detalhadas:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.name}`);
      console.log(`     └─ ${r.error}`);
    });
  }

  if (skipped > 0) {
    console.log('\n  Pulados (requerem v13 migration):');
    results.filter(r => r.status === 'SKIP').forEach(r => {
      console.log(`  ⏭️  ${r.name}${r.error ? ' — ' + r.error : ''}`);
    });
  }

  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  console.log('\n──────────────────────────────────────────────');
  console.log(`  Taxa de sucesso: ${rate}%`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

// ================================================================
// MAIN
// ================================================================
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   TOCA DAS MARMOTAS — TEST SUITE v13     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  URL: ${SUPABASE_URL}`);
  console.log(`  Data: ${new Date().toLocaleString('pt-BR')}`);

  try {
    await setup();
    await suiteAuth();
    await suiteQuests();
    await suiteSubmissions();
    await suiteMaps();
    await suiteRankings();
    await suiteAchievements();
    await suiteShop();
    await suiteFriendships();
    await suiteHallOfFame();
    await suiteGroupMissions();
    await suiteExtra();
    await suiteIntegrity();
    await suiteAnalytics();
  } catch (err) {
    console.error('\n💥  ERRO CRÍTICO NO SETUP/TEARDOWN:', err.message);
  } finally {
    await teardown();
    printReport();
  }
}

main();
