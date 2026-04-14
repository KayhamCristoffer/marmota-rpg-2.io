-- ================================================================
-- SUPABASE SQL SETUP - RPG Quests v2
-- Cole este script no SQL Editor do seu projeto Supabase
-- Dashboard > SQL Editor > New Query > Cole e Execute
-- ================================================================

-- Habilitar extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- TABELA: USERS (perfis dos jogadores)
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY,  -- Mesmo UUID do Supabase Auth
    nickname        TEXT UNIQUE NOT NULL,
    username        TEXT,
    email           TEXT UNIQUE NOT NULL,
    role            TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator')),
    icon_url        TEXT,
    level           INT DEFAULT 1,
    xp              BIGINT DEFAULT 0,
    coins           BIGINT DEFAULT 0,
    tokens          BIGINT DEFAULT 0,
    -- Contadores de período para ranking
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
CREATE TABLE IF NOT EXISTS quests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    description     TEXT,
    type            TEXT CHECK (type IN ('daily', 'weekly', 'monthly', 'event')),
    icon_url        TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    image_required  BOOLEAN DEFAULT TRUE,
    min_level       INT DEFAULT 1,
    reward_coins    INT DEFAULT 0,
    reward_xp       INT DEFAULT 0,
    -- Cooldown
    is_repeatable   BOOLEAN DEFAULT FALSE,
    cooldown_type   TEXT CHECK (cooldown_type IN ('24h', '7d', '1m')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: MAPS
-- ================================================================
CREATE TABLE IF NOT EXISTS maps (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    description     TEXT,
    type            TEXT,
    icon_url        TEXT,
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
-- TABELA: SUBMISSIONS (Quest + Map)
-- ================================================================
CREATE TABLE IF NOT EXISTS submissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    quest_id        UUID REFERENCES quests(id) ON DELETE SET NULL,
    map_id          UUID REFERENCES maps(id) ON DELETE SET NULL,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    proof_url       TEXT,  -- base64 ou URL de imagem
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);

-- ================================================================
-- TABELA: RANKING HISTORY (Histórico antes dos resets)
-- ================================================================
CREATE TABLE IF NOT EXISTS ranking_history (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    score_type      TEXT CHECK (score_type IN ('daily', 'weekly', 'monthly')),
    score_value     INT,
    period_label    TEXT,
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: ACHIEVEMENTS (Conquistas)
-- ================================================================
CREATE TABLE IF NOT EXISTS achievements (
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
-- TABELA: USER_BADGES (relação User <-> Achievement)
-- ================================================================
CREATE TABLE IF NOT EXISTS user_badges (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    achievement_id  UUID REFERENCES achievements(id) ON DELETE CASCADE,
    earned_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

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
-- FUNÇÃO: Auto-update do campo updated_at
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
-- RLS (Row Level Security) - SEGURANÇA
-- ================================================================
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_history ENABLE ROW LEVEL SECURITY;

-- ── USERS: Qualquer um pode ler, usuário edita só o próprio ──
CREATE POLICY "users_select_all" ON users FOR SELECT USING (true);
CREATE POLICY "users_insert_own" ON users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth.uid() = id);
-- Admin pode atualizar qualquer usuário
CREATE POLICY "admin_update_users" ON users FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ── QUESTS: Todos podem ler ativas; Admin escreve ────────────
CREATE POLICY "quests_select_active" ON quests FOR SELECT USING (is_active = true);
CREATE POLICY "quests_admin_all" ON quests FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);
-- Admin vê todas as quests (inclusive inativas)
CREATE POLICY "quests_admin_select_all" ON quests FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ── MAPS: Todos podem ler; Admin escreve ─────────────────────
CREATE POLICY "maps_select_all" ON maps FOR SELECT USING (true);
CREATE POLICY "maps_admin_all" ON maps FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "maps_likes_update" ON maps FOR UPDATE USING (true) WITH CHECK (true);

-- ── SUBMISSIONS: Usuário vê/cria as próprias; Admin vê todas ─
CREATE POLICY "submissions_select_own" ON submissions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "submissions_insert_own" ON submissions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "submissions_admin_all" ON submissions FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ── ACHIEVEMENTS: Todos leem; Admin escreve ──────────────────
CREATE POLICY "achievements_select_all" ON achievements FOR SELECT USING (true);
CREATE POLICY "achievements_admin_all" ON achievements FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ── USER_BADGES: Usuário vê os próprios; Admin vê todos ──────
CREATE POLICY "badges_select_own" ON user_badges FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "badges_admin_select" ON user_badges FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "badges_insert_admin" ON user_badges FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ── RANKING HISTORY: Admin escreve/lê ────────────────────────
CREATE POLICY "ranking_history_admin" ON ranking_history FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- ================================================================
-- ÍNDICES para melhor performance
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_users_role          ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_coins         ON users(coins DESC);
CREATE INDEX IF NOT EXISTS idx_users_coins_daily   ON users(coins_daily DESC);
CREATE INDEX IF NOT EXISTS idx_users_coins_weekly  ON users(coins_weekly DESC);
CREATE INDEX IF NOT EXISTS idx_users_coins_monthly ON users(coins_monthly DESC);
CREATE INDEX IF NOT EXISTS idx_quests_active       ON quests(is_active);
CREATE INDEX IF NOT EXISTS idx_quests_type         ON quests(type);
CREATE INDEX IF NOT EXISTS idx_submissions_user    ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status  ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_quest   ON submissions(quest_id);

-- ================================================================
-- DADOS INICIAIS (Quests de exemplo)
-- ================================================================
INSERT INTO quests (title, description, type, icon_url, reward_coins, reward_xp, min_level, is_active, image_required)
VALUES
    ('Login Diário', 'Acesse o sistema hoje para ganhar sua recompensa diária!', 'daily', '📅', 50, 25, 1, true, false),
    ('Complete uma dungeon', 'Derrote o boss final de qualquer dungeon', 'daily', '⚔️', 100, 75, 1, true, true),
    ('Coleta de recursos', 'Colete 100 recursos de madeira ou pedra', 'weekly', '🪵', 300, 200, 1, true, true),
    ('Explorador Épico', 'Explore 5 novos territórios no mapa', 'weekly', '🗺️', 500, 350, 3, true, true),
    ('Mestre das Artes', 'Alcance nível máximo em uma profissão', 'monthly', '🔨', 1000, 800, 5, true, true),
    ('Evento de Festas', 'Participe das festividades do servidor!', 'event', '🎉', 200, 150, 1, true, false)
ON CONFLICT DO NOTHING;

INSERT INTO achievements (title, description, icon_url, quests_required, level_required, reward_coins, reward_xp)
VALUES
    ('Primeira Missão', 'Complete sua primeira quest', '🌱', 1, 0, 100, 50),
    ('Aventureiro Iniciante', 'Complete 5 quests', '⚔️', 5, 0, 250, 150),
    ('Guerreiro Experiente', 'Complete 20 quests', '🛡️', 20, 5, 500, 300),
    ('Herói da Guilda', 'Complete 50 quests', '👑', 50, 10, 1000, 600),
    ('Lendário', 'Complete 100 quests', '🌟', 100, 20, 2000, 1200)
ON CONFLICT DO NOTHING;

-- ================================================================
-- VERIFICAÇÃO FINAL
-- Execute para confirmar que tudo foi criado:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- ================================================================
