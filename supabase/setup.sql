-- ================================================================
-- TOCA DAS MARMOTAS - QUESTS v5
-- DROP + RECREATE + TRIGGERS + RLS + DADOS INICIAIS
-- Execute no: Supabase > SQL Editor > New Query > Run
-- Changelog v5:
--   FK naming: fk_<table>_<ref>
--   achievements: category_type (quest/map/event), event dates
--   shop + shop_purchases + shop_favorites tables
--   map_submissions.image_url (URL, não base64)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- DROP (ordem importa pelas FKs)
-- ================================================================
DROP TABLE IF EXISTS shop_favorites   CASCADE;
DROP TABLE IF EXISTS shop_purchases   CASCADE;
DROP TABLE IF EXISTS shop_items       CASCADE;
DROP TABLE IF EXISTS user_badges      CASCADE;
DROP TABLE IF EXISTS ranking_history  CASCADE;
DROP TABLE IF EXISTS submissions      CASCADE;
DROP TABLE IF EXISTS map_submissions  CASCADE;
DROP TABLE IF EXISTS achievements     CASCADE;
DROP TABLE IF EXISTS maps             CASCADE;
DROP TABLE IF EXISTS quests           CASCADE;
DROP TABLE IF EXISTS users            CASCADE;

DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER  IF EXISTS users_updated_at     ON users;
DROP FUNCTION IF EXISTS handle_new_user()        CASCADE;
DROP FUNCTION IF EXISTS is_admin()               CASCADE;
DROP FUNCTION IF EXISTS increment_map_likes(UUID) CASCADE;
DROP FUNCTION IF EXISTS update_updated_at()      CASCADE;

-- ================================================================
-- USERS
-- ================================================================
CREATE TABLE users (
    id               UUID PRIMARY KEY
                     CONSTRAINT fk_users_auth REFERENCES auth.users(id) ON DELETE CASCADE,
    email            TEXT UNIQUE NOT NULL,
    nickname         TEXT UNIQUE NOT NULL,
    profile_nickname TEXT,
    profile_role     TEXT DEFAULT 'Marmotinha',
    role             TEXT DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
    icon_url         TEXT,
    level            INT  DEFAULT 1,
    xp               BIGINT DEFAULT 0,
    coins            BIGINT DEFAULT 0,
    tokens           BIGINT DEFAULT 0,
    coins_daily      INT DEFAULT 0,
    coins_weekly     INT DEFAULT 0,
    coins_monthly    INT DEFAULT 0,
    tokens_daily     INT DEFAULT 0,
    tokens_weekly    INT DEFAULT 0,
    tokens_monthly   INT DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- QUESTS
-- proof_required: true = usuário deve enviar link de comprovante
--                 false = sem comprovante (ex: Login Diário)
-- ================================================================
CREATE TABLE quests (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT NOT NULL,
    description      TEXT,
    type             TEXT CHECK (type IN ('daily','weekly','monthly','event')),
    icon_url         TEXT,
    is_active        BOOLEAN DEFAULT TRUE,
    proof_required   BOOLEAN DEFAULT FALSE,
    min_level        INT DEFAULT 1,
    reward_coins     INT DEFAULT 0,
    reward_xp        INT DEFAULT 0,
    cooldown_hours   INT DEFAULT 24,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- SUBMISSIONS (quests)
-- proof_url: link https://prnt.sc/xxxx (quando proof_required=true)
-- ================================================================
CREATE TABLE submissions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL
                   CONSTRAINT fk_submissions_user REFERENCES users(id) ON DELETE CASCADE,
    quest_id       UUID NOT NULL
                   CONSTRAINT fk_submissions_quest REFERENCES quests(id) ON DELETE CASCADE,
    status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    proof_url      TEXT,
    submitted_at   TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at    TIMESTAMPTZ,
    cooldown_until TIMESTAMPTZ
);

-- ================================================================
-- MAPS (aprovados — visíveis na aba Regiões)
-- ================================================================
CREATE TABLE maps (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title         TEXT NOT NULL,
    description   TEXT,
    type          TEXT DEFAULT 'adventure',
    icon_url      TEXT,
    image_url     TEXT,
    reward_coins  INT DEFAULT 0,
    reward_tokens INT DEFAULT 0,
    reward_xp     INT DEFAULT 0,
    download_url  TEXT,
    likes_count   INT DEFAULT 0,
    views_count   INT DEFAULT 0,
    submitted_by  UUID
                  CONSTRAINT fk_maps_submitted_by REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- MAP_SUBMISSIONS (usuário envia → admin aprova + define recompensas)
-- ================================================================
CREATE TABLE map_submissions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL
                  CONSTRAINT fk_map_submissions_user REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    type          TEXT DEFAULT 'adventure',
    image_url     TEXT,
    download_url  TEXT,
    status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reward_coins  INT DEFAULT 0,
    reward_xp     INT DEFAULT 0,
    reward_tokens INT DEFAULT 0,
    admin_notes   TEXT,
    submitted_at  TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at   TIMESTAMPTZ
);

-- ================================================================
-- RANKING_HISTORY
-- ================================================================
CREATE TABLE ranking_history (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID
                 CONSTRAINT fk_ranking_history_user REFERENCES users(id) ON DELETE SET NULL,
    score_type   TEXT CHECK (score_type IN ('daily','weekly','monthly')),
    score_coins  INT DEFAULT 0,
    score_tokens INT DEFAULT 0,
    period_label TEXT,
    recorded_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- ACHIEVEMENTS
-- category_type: 'quest' | 'map' | 'event'
-- event_start / event_end: para conquistas temporais (resgate único)
-- ================================================================
CREATE TABLE achievements (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT NOT NULL,
    description      TEXT,
    category         TEXT,
    category_type    TEXT DEFAULT 'quest' CHECK (category_type IN ('quest','map','event')),
    icon_url         TEXT,
    reward_coins     INT DEFAULT 0,
    reward_tokens    INT DEFAULT 0,
    reward_xp        INT DEFAULT 0,
    quests_required  INT DEFAULT 0,
    maps_required    INT DEFAULT 0,
    level_required   INT DEFAULT 0,
    event_start      TIMESTAMPTZ,
    event_end        TIMESTAMPTZ,
    one_time_redeem  BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- USER_BADGES
-- ================================================================
CREATE TABLE user_badges (
    user_id        UUID
                   CONSTRAINT fk_user_badges_user REFERENCES users(id) ON DELETE CASCADE,
    achievement_id UUID
                   CONSTRAINT fk_user_badges_achievement REFERENCES achievements(id) ON DELETE CASCADE,
    earned_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

-- ================================================================
-- SHOP_ITEMS (Loja)
-- currency: 'coins' | 'tokens' | 'both'
-- ================================================================
CREATE TABLE shop_items (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          TEXT NOT NULL,
    description   TEXT,
    icon_url      TEXT,
    image_url     TEXT,
    category      TEXT DEFAULT 'geral',
    price_coins   INT DEFAULT 0,
    price_tokens  INT DEFAULT 0,
    currency      TEXT DEFAULT 'coins' CHECK (currency IN ('coins','tokens','both')),
    stock         INT DEFAULT -1,         -- -1 = ilimitado
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- SHOP_PURCHASES
-- ================================================================
CREATE TABLE shop_purchases (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL
                CONSTRAINT fk_shop_purchases_user REFERENCES users(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL
                CONSTRAINT fk_shop_purchases_item REFERENCES shop_items(id) ON DELETE CASCADE,
    qty         INT DEFAULT 1,
    paid_coins  INT DEFAULT 0,
    paid_tokens INT DEFAULT 0,
    purchased_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- SHOP_FAVORITES
-- ================================================================
CREATE TABLE shop_favorites (
    user_id  UUID
             CONSTRAINT fk_shop_favorites_user REFERENCES users(id) ON DELETE CASCADE,
    item_id  UUID
             CONSTRAINT fk_shop_favorites_item REFERENCES shop_items(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, item_id)
);

-- ================================================================
-- FUNÇÕES
-- ================================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    base_nick  TEXT;
    final_nick TEXT;
    counter    INT := 0;
BEGIN
    base_nick  := regexp_replace(split_part(NEW.email,'@',1),'[^a-zA-Z0-9_]','','g');
    IF length(base_nick) < 3 THEN base_nick := 'user_' || base_nick; END IF;
    base_nick  := left(base_nick, 20);
    final_nick := base_nick;
    WHILE EXISTS (SELECT 1 FROM users WHERE nickname = final_nick) LOOP
        counter    := counter + 1;
        final_nick := left(base_nick,16) || counter;
    END LOOP;
    INSERT INTO public.users (id,email,nickname,profile_nickname,role,profile_role,level,xp,coins,tokens)
    VALUES (NEW.id,NEW.email,final_nick,final_nick,'user','Marmotinha',1,0,0,0)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION increment_map_likes(map_id UUID)
RETURNS VOID AS $$
BEGIN UPDATE maps SET likes_count = likes_count + 1 WHERE id = map_id; END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_map_views(map_id UUID)
RETURNS VOID AS $$
BEGIN UPDATE maps SET views_count = views_count + 1 WHERE id = map_id; END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE maps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_purchases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_favorites  ENABLE ROW LEVEL SECURITY;

-- USERS
CREATE POLICY "u_sel" ON users FOR SELECT  USING (auth.uid() IS NOT NULL);
CREATE POLICY "u_ins" ON users FOR INSERT  WITH CHECK (auth.uid() = id);
CREATE POLICY "u_upd" ON users FOR UPDATE  USING (auth.uid() = id OR is_admin()) WITH CHECK (auth.uid() = id OR is_admin());
CREATE POLICY "u_del" ON users FOR DELETE  USING (is_admin());

-- QUESTS
CREATE POLICY "q_sel_active" ON quests FOR SELECT USING (is_active = true AND auth.uid() IS NOT NULL);
CREATE POLICY "q_sel_admin"  ON quests FOR SELECT USING (is_admin());
CREATE POLICY "q_ins"        ON quests FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "q_upd"        ON quests FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "q_del"        ON quests FOR DELETE USING (is_admin());

-- MAPS
CREATE POLICY "m_sel"        ON maps FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "m_ins"        ON maps FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "m_upd"        ON maps FOR UPDATE USING (is_admin() OR auth.uid() IS NOT NULL) WITH CHECK (is_admin() OR auth.uid() IS NOT NULL);
CREATE POLICY "m_del"        ON maps FOR DELETE USING (is_admin());

-- SUBMISSIONS
CREATE POLICY "s_sel"        ON submissions FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "s_ins"        ON submissions FOR INSERT WITH CHECK (user_id = auth.uid() AND auth.uid() IS NOT NULL);
CREATE POLICY "s_upd"        ON submissions FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "s_del"        ON submissions FOR DELETE USING (is_admin());

-- MAP_SUBMISSIONS
CREATE POLICY "ms_sel"       ON map_submissions FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "ms_ins"       ON map_submissions FOR INSERT WITH CHECK (user_id = auth.uid() AND auth.uid() IS NOT NULL);
CREATE POLICY "ms_upd"       ON map_submissions FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "ms_del"       ON map_submissions FOR DELETE USING (is_admin());

-- ACHIEVEMENTS
CREATE POLICY "a_sel"        ON achievements FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "a_ins"        ON achievements FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "a_upd"        ON achievements FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "a_del"        ON achievements FOR DELETE USING (is_admin());

-- USER_BADGES
CREATE POLICY "ub_sel"       ON user_badges FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "ub_ins"       ON user_badges FOR INSERT WITH CHECK (is_admin() OR user_id = auth.uid());
CREATE POLICY "ub_del"       ON user_badges FOR DELETE USING (is_admin());

-- RANKING_HISTORY
CREATE POLICY "rh_sel"       ON ranking_history FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "rh_ins"       ON ranking_history FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "rh_upd"       ON ranking_history FOR UPDATE USING (is_admin());

-- SHOP_ITEMS
CREATE POLICY "si_sel"       ON shop_items FOR SELECT USING (is_active = true AND auth.uid() IS NOT NULL);
CREATE POLICY "si_sel_admin" ON shop_items FOR SELECT USING (is_admin());
CREATE POLICY "si_ins"       ON shop_items FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "si_upd"       ON shop_items FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "si_del"       ON shop_items FOR DELETE USING (is_admin());

-- SHOP_PURCHASES
CREATE POLICY "sp_sel"       ON shop_purchases FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "sp_ins"       ON shop_purchases FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "sp_del"       ON shop_purchases FOR DELETE USING (is_admin());

-- SHOP_FAVORITES
CREATE POLICY "sf_sel"       ON shop_favorites FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "sf_ins"       ON shop_favorites FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "sf_del"       ON shop_favorites FOR DELETE USING (user_id = auth.uid());

-- ================================================================
-- ÍNDICES
-- ================================================================
CREATE INDEX idx_users_role          ON users(role);
CREATE INDEX idx_users_coins         ON users(coins DESC);
CREATE INDEX idx_users_coins_daily   ON users(coins_daily DESC);
CREATE INDEX idx_users_coins_weekly  ON users(coins_weekly DESC);
CREATE INDEX idx_users_coins_monthly ON users(coins_monthly DESC);
CREATE INDEX idx_users_tokens        ON users(tokens DESC);
CREATE INDEX idx_quests_active       ON quests(is_active);
CREATE INDEX idx_quests_type         ON quests(type);
CREATE INDEX idx_subs_user           ON submissions(user_id);
CREATE INDEX idx_subs_status         ON submissions(status);
CREATE INDEX idx_subs_quest          ON submissions(quest_id);
CREATE INDEX idx_mapsub_user         ON map_submissions(user_id);
CREATE INDEX idx_mapsub_status       ON map_submissions(status);
CREATE INDEX idx_shop_active         ON shop_items(is_active);
CREATE INDEX idx_shop_purch_user     ON shop_purchases(user_id);
CREATE INDEX idx_rh_type_period      ON ranking_history(score_type, period_label);

-- ================================================================
-- DADOS INICIAIS — Quests de exemplo
-- proof_required: false = não precisa de comprovante
-- ================================================================
INSERT INTO quests (title,description,type,icon_url,reward_coins,reward_xp,min_level,is_active,proof_required,cooldown_hours)
VALUES
  ('Login Diário',        'Acesse o sistema e registre sua presença diária!',   'daily',   '📅', 50,  25, 1, true, false, 24),
  ('Complete uma Dungeon','Derrote o boss final de qualquer dungeon',            'daily',   '⚔️', 100, 75, 1, true, true,  24),
  ('Coleta de Recursos',  'Colete 100 recursos de madeira ou pedra',             'weekly',  '🪵', 300,200, 1, true, true, 168),
  ('Explorador Épico',    'Explore 5 novos territórios no mapa',                 'weekly',  '🗺️', 500,350, 3, true, true, 168),
  ('Mestre das Artes',    'Alcance nível máximo em uma profissão',               'monthly', '🔨',1000,800, 5, true, true, 720),
  ('Evento de Festas',    'Participe das festividades do servidor!',             'event',   '🎉', 200,150, 1, true, true,   0)
ON CONFLICT DO NOTHING;

INSERT INTO achievements (title,description,icon_url,category_type,quests_required,level_required,reward_coins,reward_xp)
VALUES
  ('Primeira Missão',        'Complete sua primeira quest',  '🌱','quest', 1,  0, 100,  50),
  ('Aventureiro Iniciante',  'Complete 5 quests',            '⚔️','quest', 5,  0, 250, 150),
  ('Guerreiro Experiente',   'Complete 20 quests',           '🛡️','quest',20,  5, 500, 300),
  ('Herói da Guilda',        'Complete 50 quests',           '👑','quest',50, 10,1000, 600),
  ('Lendário',               'Complete 100 quests',          '🌟','quest',100,20,2000,1200),
  ('Cartógrafo',             'Tenha 1 mapa aprovado',        '🗺️','map',   0,  0, 300, 200)
ON CONFLICT DO NOTHING;

-- ================================================================
-- RECUPERAR USUÁRIOS AUTH SEM PERFIL (executar separadamente)
-- ================================================================
-- INSERT INTO users (id,email,nickname,profile_nickname,role,profile_role,level,xp,coins,tokens)
-- SELECT au.id, au.email,
--   regexp_replace(split_part(au.email,'@',1),'[^a-zA-Z0-9_]','','g') AS nickname,
--   regexp_replace(split_part(au.email,'@',1),'[^a-zA-Z0-9_]','','g') AS profile_nickname,
--   'user','Marmotinha',1,0,0,0
-- FROM auth.users au
-- LEFT JOIN public.users pu ON pu.id = au.id
-- WHERE pu.id IS NULL;
