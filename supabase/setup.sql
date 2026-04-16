-- ================================================================
-- SUPABASE SQL SETUP v2 - RPG Quests
-- SCRIPT COMPLETO: Drop + Recreate + RLS corrigidas + Trigger auto-user
-- Cole no SQL Editor: Dashboard > SQL Editor > New Query > Execute
-- ================================================================

-- Habilitar extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- DROP ANTIGO (ordem importa para foreign keys)
-- ================================================================
DROP TABLE IF EXISTS user_badges      CASCADE;
DROP TABLE IF EXISTS ranking_history  CASCADE;
DROP TABLE IF EXISTS submissions      CASCADE;
DROP TABLE IF EXISTS achievements     CASCADE;
DROP TABLE IF EXISTS maps             CASCADE;
DROP TABLE IF EXISTS quests           CASCADE;
DROP TABLE IF EXISTS users            CASCADE;

-- Drop trigger antigo se existir
DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- ================================================================
-- TABELA: USERS
-- ================================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email           TEXT UNIQUE NOT NULL,
    nickname        TEXT UNIQUE NOT NULL,
    username        TEXT,
    profile_nickname TEXT,           -- Apelido customizável (sem alterar nickname único)
    role            TEXT DEFAULT 'user' CHECK (role IN ('user','admin','moderator','marmotinha')),
    profile_role    TEXT DEFAULT 'Marmotinha', -- Cargo exibido (editável pelo admin)
    icon_url        TEXT,
    level           INT DEFAULT 1,
    xp              BIGINT DEFAULT 0,
    coins           BIGINT DEFAULT 0,
    tokens          BIGINT DEFAULT 0,
    coins_daily     INT DEFAULT 0,
    coins_weekly    INT DEFAULT 0,
    coins_monthly   INT DEFAULT 0,
    tokens_daily    INT DEFAULT 0,
    tokens_weekly   INT DEFAULT 0,
    tokens_monthly  INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: QUESTS
-- ================================================================
CREATE TABLE quests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    description     TEXT,
    type            TEXT CHECK (type IN ('daily','weekly','monthly','event')),
    icon_url        TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    image_required  BOOLEAN DEFAULT TRUE,
    min_level       INT DEFAULT 1,
    reward_coins    INT DEFAULT 0,
    reward_xp       INT DEFAULT 0,
    is_repeatable   BOOLEAN DEFAULT FALSE,
    cooldown_type   TEXT CHECK (cooldown_type IN ('24h','7d','1m')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: MAPS
-- ================================================================
CREATE TABLE maps (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    description     TEXT,
    type            TEXT DEFAULT 'adventure',
    icon_url        TEXT,
    image_url       TEXT,           -- URL da imagem do mapa
    image_required  BOOLEAN DEFAULT FALSE,
    reward_coins    INT DEFAULT 0,
    reward_tokens   INT DEFAULT 0,
    reward_xp       INT DEFAULT 0,
    download_url    TEXT,
    likes_count     INT DEFAULT 0,
    views_count     INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: SUBMISSIONS
-- ================================================================
CREATE TABLE submissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_id        UUID REFERENCES quests(id) ON DELETE SET NULL,
    map_id          UUID REFERENCES maps(id) ON DELETE SET NULL,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    proof_url       TEXT,
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);

-- ================================================================
-- TABELA: RANKING HISTORY
-- ================================================================
CREATE TABLE ranking_history (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    score_type      TEXT CHECK (score_type IN ('daily','weekly','monthly')),
    score_value     INT,
    period_label    TEXT,
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: ACHIEVEMENTS
-- ================================================================
CREATE TABLE achievements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    description     TEXT,
    category        TEXT,
    icon_url        TEXT,
    reward_coins    INT DEFAULT 0,
    reward_tokens   INT DEFAULT 0,
    reward_xp       INT DEFAULT 0,
    quests_required INT DEFAULT 0,
    level_required  INT DEFAULT 0,
    maps_required   INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: USER_BADGES
-- ================================================================
CREATE TABLE user_badges (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    achievement_id  UUID REFERENCES achievements(id) ON DELETE CASCADE,
    earned_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

-- ================================================================
-- FUNÇÃO: Auto-create user profile no cadastro
-- Roda automaticamente quando um usuário se registra no Auth
-- ================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_nick TEXT;
  final_nick TEXT;
  counter   INT := 0;
BEGIN
  -- Gera nickname base a partir do email (parte antes do @)
  base_nick := split_part(NEW.email, '@', 1);
  -- Remove caracteres inválidos
  base_nick := regexp_replace(base_nick, '[^a-zA-Z0-9_]', '', 'g');
  -- Garante pelo menos 3 chars
  IF length(base_nick) < 3 THEN base_nick := 'user_' || base_nick; END IF;
  -- Trunka em 20 chars
  base_nick := left(base_nick, 20);
  final_nick := base_nick;

  -- Resolve colisões de nickname
  WHILE EXISTS (SELECT 1 FROM users WHERE nickname = final_nick) LOOP
    counter := counter + 1;
    final_nick := left(base_nick, 16) || counter;
  END LOOP;

  INSERT INTO public.users (id, email, nickname, username, profile_nickname, role, profile_role, level, xp, coins, tokens)
  VALUES (
    NEW.id,
    NEW.email,
    final_nick,
    final_nick,
    final_nick,   -- profile_nickname igual ao nickname por padrão
    'user',
    'Marmotinha',
    1, 0, 0, 0
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger que dispara ao criar usuário no Auth
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ================================================================
-- FUNÇÃO: Incrementar likes de mapa
-- ================================================================
CREATE OR REPLACE FUNCTION increment_map_likes(map_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE maps SET likes_count = likes_count + 1 WHERE id = map_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- FUNÇÃO: Auto-update updated_at
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_history  ENABLE ROW LEVEL SECURITY;

-- ── Função auxiliar: verifica se usuário logado é admin ──────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ── USERS ─────────────────────────────────────────────────────
-- Qualquer autenticado pode ler todos os usuários (ranking, perfil)
CREATE POLICY "users_select"        ON users FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Trigger cuida do insert; mas permitimos também o insert direto do cliente
-- (necessário para o signUp via JS quando o trigger não rodou a tempo)
CREATE POLICY "users_insert_own"    ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Usuário atualiza o próprio perfil
CREATE POLICY "users_update_own"    ON users FOR UPDATE
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admin atualiza qualquer usuário (role, profile_role, etc.)
CREATE POLICY "users_admin_update"  ON users FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

-- Admin pode deletar usuários
CREATE POLICY "users_admin_delete"  ON users FOR DELETE
  USING  (is_admin());

-- ── QUESTS ────────────────────────────────────────────────────
-- Usuários autenticados veem quests ativas
CREATE POLICY "quests_select_active" ON quests FOR SELECT
  USING (is_active = true AND auth.uid() IS NOT NULL);

-- Admin vê todas (inclusive inativas)
CREATE POLICY "quests_admin_select" ON quests FOR SELECT
  USING (is_admin());

-- Apenas admin pode inserir/atualizar/deletar
CREATE POLICY "quests_admin_insert" ON quests FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "quests_admin_update" ON quests FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "quests_admin_delete" ON quests FOR DELETE
  USING  (is_admin());

-- ── MAPS ──────────────────────────────────────────────────────
-- Qualquer autenticado lê mapas
CREATE POLICY "maps_select_auth"    ON maps FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Admin pode tudo
CREATE POLICY "maps_admin_insert"   ON maps FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "maps_admin_update"   ON maps FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "maps_admin_delete"   ON maps FOR DELETE
  USING  (is_admin());

-- Qualquer autenticado pode dar like (UPDATE apenas likes_count)
CREATE POLICY "maps_like_update"    ON maps FOR UPDATE
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── SUBMISSIONS ───────────────────────────────────────────────
-- Usuário vê suas próprias submissões
CREATE POLICY "submissions_select_own" ON submissions FOR SELECT
  USING (user_id = auth.uid());

-- Admin vê todas
CREATE POLICY "submissions_admin_select" ON submissions FOR SELECT
  USING (is_admin());

-- Usuário cria submissão para si mesmo
CREATE POLICY "submissions_insert_own" ON submissions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth.uid() IS NOT NULL);

-- Admin pode atualizar/deletar
CREATE POLICY "submissions_admin_update" ON submissions FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "submissions_admin_delete" ON submissions FOR DELETE
  USING  (is_admin());

-- ── ACHIEVEMENTS ──────────────────────────────────────────────
-- Qualquer autenticado lê conquistas
CREATE POLICY "achievements_select"   ON achievements FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Apenas admin escreve
CREATE POLICY "achievements_admin_insert" ON achievements FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "achievements_admin_update" ON achievements FOR UPDATE
  USING  (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "achievements_admin_delete" ON achievements FOR DELETE
  USING  (is_admin());

-- ── USER_BADGES ───────────────────────────────────────────────
-- Usuário vê seus badges
CREATE POLICY "badges_select_own"     ON user_badges FOR SELECT
  USING (user_id = auth.uid());

-- Admin vê todos
CREATE POLICY "badges_admin_select"   ON user_badges FOR SELECT
  USING (is_admin());

-- Admin (e SECURITY DEFINER de checkAndGrantAchievements) insere badges
CREATE POLICY "badges_insert"         ON user_badges FOR INSERT
  WITH CHECK (is_admin() OR user_id = auth.uid());

-- ── RANKING HISTORY ───────────────────────────────────────────
-- Qualquer autenticado lê histórico
CREATE POLICY "rh_select"             ON ranking_history FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Apenas admin escreve
CREATE POLICY "rh_admin_insert"       ON ranking_history FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "rh_admin_update"       ON ranking_history FOR UPDATE
  USING  (is_admin());

-- ================================================================
-- ÍNDICES
-- ================================================================
CREATE INDEX idx_users_role           ON users(role);
CREATE INDEX idx_users_coins          ON users(coins DESC);
CREATE INDEX idx_users_coins_daily    ON users(coins_daily DESC);
CREATE INDEX idx_users_coins_weekly   ON users(coins_weekly DESC);
CREATE INDEX idx_users_coins_monthly  ON users(coins_monthly DESC);
CREATE INDEX idx_users_tokens         ON users(tokens DESC);
CREATE INDEX idx_quests_active        ON quests(is_active);
CREATE INDEX idx_quests_type          ON quests(type);
CREATE INDEX idx_submissions_user     ON submissions(user_id);
CREATE INDEX idx_submissions_status   ON submissions(status);
CREATE INDEX idx_submissions_quest    ON submissions(quest_id);

-- ================================================================
-- DADOS INICIAIS
-- ================================================================
INSERT INTO quests (title, description, type, icon_url, reward_coins, reward_xp, min_level, is_active, image_required)
VALUES
  ('Login Diário',        'Acesse o sistema e ganhe sua recompensa!',            'daily',   '📅', 50,   25,  1, true, false),
  ('Complete uma dungeon','Derrote o boss final de qualquer dungeon',             'daily',   '⚔️', 100,  75,  1, true, true),
  ('Coleta de recursos',  'Colete 100 recursos de madeira ou pedra',              'weekly',  '🪵', 300, 200,  1, true, true),
  ('Explorador Épico',    'Explore 5 novos territórios no mapa',                  'weekly',  '🗺️', 500, 350,  3, true, true),
  ('Mestre das Artes',    'Alcance nível máximo em uma profissão',                'monthly', '🔨',1000, 800,  5, true, true),
  ('Evento de Festas',    'Participe das festividades do servidor!',              'event',   '🎉', 200, 150,  1, true, false)
ON CONFLICT DO NOTHING;

INSERT INTO achievements (title, description, icon_url, quests_required, level_required, reward_coins, reward_xp)
VALUES
  ('Primeira Missão',       'Complete sua primeira quest',  '🌱',   1,  0, 100,   50),
  ('Aventureiro Iniciante', 'Complete 5 quests',            '⚔️',   5,  0, 250,  150),
  ('Guerreiro Experiente',  'Complete 20 quests',           '🛡️',  20,  5, 500,  300),
  ('Herói da Guilda',       'Complete 50 quests',           '👑',  50, 10,1000,  600),
  ('Lendário',              'Complete 100 quests',          '🌟', 100, 20,2000, 1200)
ON CONFLICT DO NOTHING;

-- ================================================================
-- VERIFICAÇÃO
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- ================================================================
