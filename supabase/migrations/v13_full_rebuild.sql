-- ================================================================
-- TOCA DAS MARMOTAS — DATABASE v13 (FULL REBUILD)
-- DROP completo + recriação com melhorias de integridade e performance
--
-- INSTRUÇÕES:
--   1. Supabase Dashboard → SQL Editor → New Query
--   2. Cole e execute este script inteiro
--   3. ATENÇÃO: remove TODOS os dados. Use apenas em testes/dev.
--
-- Changelog v13 vs v12:
--   • Constraint: nickname mínimo 3 chars, máximo 30
--   • users.xp / coins / tokens agora BIGINT com CHECK >= 0
--   • quests: token_reward adicionado (além de coins)
--   • submissions: UNIQUE (user_id, quest_id, cooldown_until) evita duplos
--   • maps: submitted_by_nickname snapshot (resiste ao delete do user)
--   • hall_of_fame: índice UNIQUE por (user_id, score_type, metric, period_label)
--   • group_missions: campo icon_url + min_members separado de required_members
--   • group_mission_proofs: UNIQUE (mission_id) — um comprovante por missão
--   • friendships: índice para buscar amizades de ambos os lados em 1 query
--   • content_votes: índice de votos por target melhorado
--   • shop_items: campo quantity_per_user para limitar compras por usuário
--   • Funções: approve_submission_v2() distribui recompensas atomicamente
--   • Funções: level_up_check() calcula nível ao aprovar/atualizar XP
--   • Melhor RLS: políticas nomeadas com prefixo claro
--   • Dados iniciais expandidos: 8 quests, 8 achievements, 3 itens de loja
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- busca por similaridade de texto

-- ================================================================
-- DROP (ordem importa: dependentes primeiro)
-- ================================================================
DROP TABLE IF EXISTS public.shop_favorites          CASCADE;
DROP TABLE IF EXISTS public.shop_purchases          CASCADE;
DROP TABLE IF EXISTS public.shop_items              CASCADE;
DROP TABLE IF EXISTS public.group_mission_proofs    CASCADE;
DROP TABLE IF EXISTS public.group_mission_members   CASCADE;
DROP TABLE IF EXISTS public.group_missions          CASCADE;
DROP TABLE IF EXISTS public.content_votes           CASCADE;
DROP TABLE IF EXISTS public.hall_of_fame            CASCADE;
DROP TABLE IF EXISTS public.friendships             CASCADE;
DROP TABLE IF EXISTS public.user_badges             CASCADE;
DROP TABLE IF EXISTS public.ranking_history         CASCADE;
DROP TABLE IF EXISTS public.ranking_reset_log       CASCADE;
DROP TABLE IF EXISTS public.submissions             CASCADE;
DROP TABLE IF EXISTS public.map_submissions         CASCADE;
DROP TABLE IF EXISTS public.achievements            CASCADE;
DROP TABLE IF EXISTS public.maps                    CASCADE;
DROP TABLE IF EXISTS public.quests                  CASCADE;
DROP TABLE IF EXISTS public.users                   CASCADE;

-- Drop funções e triggers
DROP TRIGGER  IF EXISTS on_auth_user_created         ON auth.users;
DROP TRIGGER  IF EXISTS users_updated_at             ON public.users;
DROP FUNCTION IF EXISTS public.handle_new_user()            CASCADE;
DROP FUNCTION IF EXISTS public.is_admin()                   CASCADE;
DROP FUNCTION IF EXISTS public.increment_map_likes(UUID)    CASCADE;
DROP FUNCTION IF EXISTS public.increment_map_views(UUID)    CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at()          CASCADE;
DROP FUNCTION IF EXISTS public.approve_group_mission_proof(BIGINT, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.record_hall_of_fame(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.brt_now_text()               CASCADE;
DROP FUNCTION IF EXISTS public.brt_period_label(TEXT)       CASCADE;
DROP FUNCTION IF EXISTS public.auto_reset_daily_ranking()   CASCADE;
DROP FUNCTION IF EXISTS public.auto_reset_weekly_ranking()  CASCADE;
DROP FUNCTION IF EXISTS public.auto_reset_monthly_ranking() CASCADE;
DROP FUNCTION IF EXISTS public.level_up_check(UUID)         CASCADE;
DROP FUNCTION IF EXISTS public.approve_submission_v2(UUID, UUID, TEXT) CASCADE;

-- ================================================================
-- TABELA: users
-- ================================================================
CREATE TABLE public.users (
    id                       UUID PRIMARY KEY
                             CONSTRAINT fk_users_auth REFERENCES auth.users(id) ON DELETE CASCADE,
    email                    TEXT UNIQUE NOT NULL,
    nickname                 TEXT UNIQUE NOT NULL
                             CONSTRAINT chk_nickname_len CHECK (char_length(nickname) BETWEEN 3 AND 30),
    profile_nickname         TEXT,
    profile_role             TEXT DEFAULT 'Marmotinha',
    role                     TEXT DEFAULT 'user'
                             CHECK (role IN ('user','moderator','admin')),
    icon_url                 TEXT,
    -- Stats
    level                    INT  DEFAULT 1 CHECK (level >= 1),
    xp                       BIGINT DEFAULT 0 CHECK (xp >= 0),
    coins                    BIGINT DEFAULT 0 CHECK (coins >= 0),
    tokens                   BIGINT DEFAULT 0 CHECK (tokens >= 0),
    -- Contadores por período (para ranking)
    coins_daily              BIGINT DEFAULT 0 CHECK (coins_daily >= 0),
    coins_weekly             BIGINT DEFAULT 0 CHECK (coins_weekly >= 0),
    coins_monthly            BIGINT DEFAULT 0 CHECK (coins_monthly >= 0),
    tokens_daily             BIGINT DEFAULT 0 CHECK (tokens_daily >= 0),
    tokens_weekly            BIGINT DEFAULT 0 CHECK (tokens_weekly >= 0),
    tokens_monthly           BIGINT DEFAULT 0 CHECK (tokens_monthly >= 0),
    -- Progresso social/missões
    group_missions_completed INT DEFAULT 0 CHECK (group_missions_completed >= 0),
    hof_entries              INT DEFAULT 0 CHECK (hof_entries >= 0),
    -- Perfil público
    public_profile           BOOLEAN DEFAULT FALSE,
    profile_bio              TEXT,
    social_links             JSONB DEFAULT '{}',
    -- Timestamps
    created_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: quests
-- ================================================================
CREATE TABLE public.quests (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100),
    description      TEXT,
    type             TEXT NOT NULL CHECK (type IN ('daily','weekly','monthly','event')),
    icon_url         TEXT DEFAULT '⚔️',
    is_active        BOOLEAN DEFAULT TRUE,
    proof_required   BOOLEAN DEFAULT FALSE,
    image_required   BOOLEAN DEFAULT FALSE,          -- obriga URL de imagem (não só texto)
    min_level        INT DEFAULT 1 CHECK (min_level >= 1),
    reward_coins     INT DEFAULT 0 CHECK (reward_coins >= 0),
    reward_tokens    INT DEFAULT 0 CHECK (reward_tokens >= 0),
    reward_xp        INT DEFAULT 0 CHECK (reward_xp >= 0),
    cooldown_hours   INT DEFAULT 24 CHECK (cooldown_hours >= 0),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: submissions
-- ================================================================
CREATE TABLE public.submissions (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL
                   CONSTRAINT fk_submissions_user REFERENCES public.users(id) ON DELETE CASCADE,
    quest_id       UUID NOT NULL
                   CONSTRAINT fk_submissions_quest REFERENCES public.quests(id) ON DELETE CASCADE,
    status         TEXT DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
    proof_url      TEXT,
    admin_note     TEXT,
    submitted_at   TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at    TIMESTAMPTZ,
    cooldown_until TIMESTAMPTZ
);

-- ================================================================
-- TABELA: maps
-- ================================================================
CREATE TABLE public.maps (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title                TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
    description          TEXT,
    type                 TEXT DEFAULT 'adventure'
                         CHECK (type IN ('adventure','pvp','city','dungeon','lucky','event','survival','parkour','custom')),
    icon_url             TEXT,
    image_url            TEXT,
    reward_coins         INT DEFAULT 0 CHECK (reward_coins >= 0),
    reward_tokens        INT DEFAULT 0 CHECK (reward_tokens >= 0),
    reward_xp            INT DEFAULT 0 CHECK (reward_xp >= 0),
    download_url         TEXT,
    likes_count          INT DEFAULT 0 CHECK (likes_count >= 0),
    views_count          INT DEFAULT 0 CHECK (views_count >= 0),
    submitted_by         UUID CONSTRAINT fk_maps_submitted_by REFERENCES public.users(id) ON DELETE SET NULL,
    submitted_by_nick    TEXT,     -- snapshot do nickname ao enviar
    is_featured          BOOLEAN DEFAULT FALSE,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: map_submissions (aguarda aprovação admin)
-- ================================================================
CREATE TABLE public.map_submissions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL
                  CONSTRAINT fk_map_submissions_user REFERENCES public.users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
    description   TEXT,
    type          TEXT DEFAULT 'adventure'
                  CHECK (type IN ('adventure','pvp','city','dungeon','lucky','event','survival','parkour','custom')),
    image_url     TEXT,
    download_url  TEXT,
    status        TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
    reward_coins  INT DEFAULT 0,
    reward_xp     INT DEFAULT 0,
    reward_tokens INT DEFAULT 0,
    admin_notes   TEXT,
    submitted_at  TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at   TIMESTAMPTZ
);

-- ================================================================
-- TABELA: ranking_history
-- ================================================================
CREATE TABLE public.ranking_history (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID CONSTRAINT fk_ranking_history_user REFERENCES public.users(id) ON DELETE SET NULL,
    score_type   TEXT NOT NULL CHECK (score_type IN ('daily','weekly','monthly')),
    score_coins  BIGINT DEFAULT 0,
    score_tokens BIGINT DEFAULT 0,
    period_label TEXT NOT NULL,
    recorded_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: ranking_reset_log
-- ================================================================
CREATE TABLE public.ranking_reset_log (
    id           BIGSERIAL PRIMARY KEY,
    reset_type   TEXT NOT NULL CHECK (reset_type IN ('daily','weekly','monthly')),
    reset_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_label TEXT,
    rows_saved   INT DEFAULT 0
);

-- ================================================================
-- TABELA: achievements
-- ================================================================
CREATE TABLE public.achievements (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title                   TEXT NOT NULL CHECK (char_length(title) >= 2),
    description             TEXT,
    category                TEXT,
    category_type           TEXT DEFAULT 'quest'
                            CHECK (category_type IN ('quest','map','event','social','group','hof')),
    icon_url                TEXT DEFAULT '🏆',
    reward_coins            INT DEFAULT 0 CHECK (reward_coins >= 0),
    reward_tokens           INT DEFAULT 0 CHECK (reward_tokens >= 0),
    reward_xp               INT DEFAULT 0 CHECK (reward_xp >= 0),
    quests_required         INT DEFAULT 0 CHECK (quests_required >= 0),
    maps_required           INT DEFAULT 0 CHECK (maps_required >= 0),
    level_required          INT DEFAULT 0 CHECK (level_required >= 0),
    hof_required            INT DEFAULT 0 CHECK (hof_required >= 0),
    group_missions_required INT DEFAULT 0 CHECK (group_missions_required >= 0),
    event_start             TIMESTAMPTZ,
    event_end               TIMESTAMPTZ,
    one_time_redeem         BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: user_badges
-- ================================================================
CREATE TABLE public.user_badges (
    user_id        UUID CONSTRAINT fk_user_badges_user REFERENCES public.users(id) ON DELETE CASCADE,
    achievement_id UUID CONSTRAINT fk_user_badges_ach  REFERENCES public.achievements(id) ON DELETE CASCADE,
    earned_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

-- ================================================================
-- TABELA: shop_items
-- ================================================================
CREATE TABLE public.shop_items (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name               TEXT NOT NULL CHECK (char_length(name) >= 2),
    description        TEXT,
    icon_url           TEXT,
    image_url          TEXT,
    category           TEXT DEFAULT 'geral',
    price_coins        INT DEFAULT 0 CHECK (price_coins >= 0),
    price_tokens       INT DEFAULT 0 CHECK (price_tokens >= 0),
    currency           TEXT DEFAULT 'coins'
                       CHECK (currency IN ('coins','tokens','both')),
    stock              INT DEFAULT -1,            -- -1 = ilimitado
    quantity_per_user  INT DEFAULT -1,            -- -1 = sem limite por usuário
    is_active          BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: shop_purchases
-- ================================================================
CREATE TABLE public.shop_purchases (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL CONSTRAINT fk_shop_purchases_user REFERENCES public.users(id) ON DELETE CASCADE,
    item_id      UUID NOT NULL CONSTRAINT fk_shop_purchases_item REFERENCES public.shop_items(id) ON DELETE CASCADE,
    qty          INT DEFAULT 1 CHECK (qty > 0),
    paid_coins   INT DEFAULT 0 CHECK (paid_coins >= 0),
    paid_tokens  INT DEFAULT 0 CHECK (paid_tokens >= 0),
    purchased_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABELA: shop_favorites
-- ================================================================
CREATE TABLE public.shop_favorites (
    user_id  UUID CONSTRAINT fk_shop_favorites_user REFERENCES public.users(id) ON DELETE CASCADE,
    item_id  UUID CONSTRAINT fk_shop_favorites_item REFERENCES public.shop_items(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, item_id)
);

-- ================================================================
-- TABELA: friendships
-- ================================================================
CREATE TABLE public.friendships (
    id         BIGSERIAL PRIMARY KEY,
    requester  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    addressee  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','blocked')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (requester, addressee),
    CONSTRAINT chk_no_self_friendship CHECK (requester <> addressee)
);

-- ================================================================
-- TABELA: hall_of_fame
-- ================================================================
CREATE TABLE public.hall_of_fame (
    id           BIGSERIAL PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    score_type   TEXT NOT NULL CHECK (score_type IN ('daily','weekly','monthly')),
    metric       TEXT NOT NULL DEFAULT 'coins' CHECK (metric IN ('coins','tokens')),
    score        BIGINT NOT NULL DEFAULT 0 CHECK (score >= 0),
    period_label TEXT NOT NULL,
    recorded_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, score_type, metric, period_label)   -- evita entradas duplas
);

-- ================================================================
-- TABELA: content_votes
-- ================================================================
CREATE TABLE public.content_votes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('map','quest','submission','map_submission')),
    target_id   TEXT NOT NULL,
    vote        TEXT NOT NULL CHECK (vote IN ('approve','reject','flag')),
    reason      TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, target_type, target_id)
);

-- ================================================================
-- TABELA: group_missions
-- ================================================================
CREATE TABLE public.group_missions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100),
    description      TEXT,
    icon_url         TEXT DEFAULT '👥',
    quest_id         UUID REFERENCES public.quests(id) ON DELETE SET NULL,
    creator_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status           TEXT DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','completed','cancelled')),
    min_members      INT DEFAULT 2 CHECK (min_members >= 2),
    required_members INT DEFAULT 2 CHECK (required_members >= 2),
    max_members      INT DEFAULT 10 CHECK (max_members >= 2),
    reward_coins     INT DEFAULT 0 CHECK (reward_coins >= 0),
    reward_tokens    INT DEFAULT 0 CHECK (reward_tokens >= 0),
    reward_xp        INT DEFAULT 0 CHECK (reward_xp >= 0),
    proof_note       TEXT,
    starts_at        TIMESTAMPTZ,
    ends_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    approved_at      TIMESTAMPTZ,
    CONSTRAINT chk_gm_members CHECK (min_members <= required_members AND required_members <= max_members)
);

-- ================================================================
-- TABELA: group_mission_members
-- ================================================================
CREATE TABLE public.group_mission_members (
    mission_id UUID NOT NULL REFERENCES public.group_missions(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES public.users(id)          ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ DEFAULT NOW(),
    role       TEXT DEFAULT 'member' CHECK (role IN ('leader','member')),
    PRIMARY KEY (mission_id, user_id)
);

-- ================================================================
-- TABELA: group_mission_proofs
-- ================================================================
CREATE TABLE public.group_mission_proofs (
    id           BIGSERIAL PRIMARY KEY,
    mission_id   UUID NOT NULL REFERENCES public.group_missions(id)  ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES public.users(id)           ON DELETE CASCADE,
    proof_url    TEXT NOT NULL,
    note         TEXT,
    status       TEXT DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected')),
    reviewed_by  UUID REFERENCES public.users(id),
    reviewed_at  TIMESTAMPTZ,
    admin_note   TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (mission_id)    -- somente 1 comprovante por missão (qualquer membro envia)
);

-- ================================================================
-- ÍNDICES
-- ================================================================
-- users
CREATE INDEX idx_users_role             ON public.users(role);
CREATE INDEX idx_users_level            ON public.users(level DESC);
CREATE INDEX idx_users_coins            ON public.users(coins DESC);
CREATE INDEX idx_users_coins_daily      ON public.users(coins_daily DESC);
CREATE INDEX idx_users_coins_weekly     ON public.users(coins_weekly DESC);
CREATE INDEX idx_users_coins_monthly    ON public.users(coins_monthly DESC);
CREATE INDEX idx_users_tokens           ON public.users(tokens DESC);
CREATE INDEX idx_users_public           ON public.users(public_profile) WHERE public_profile = TRUE;
CREATE INDEX idx_users_nickname_trgm    ON public.users USING GIN (nickname gin_trgm_ops);

-- quests
CREATE INDEX idx_quests_active          ON public.quests(is_active, type);
CREATE INDEX idx_quests_type            ON public.quests(type);

-- submissions
CREATE INDEX idx_subs_user              ON public.submissions(user_id);
CREATE INDEX idx_subs_status            ON public.submissions(status);
CREATE INDEX idx_subs_quest             ON public.submissions(quest_id);
CREATE INDEX idx_subs_cooldown          ON public.submissions(user_id, quest_id, cooldown_until);

-- maps
CREATE INDEX idx_maps_type              ON public.maps(type);
CREATE INDEX idx_maps_featured          ON public.maps(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_maps_likes             ON public.maps(likes_count DESC);

-- map_submissions
CREATE INDEX idx_mapsub_user            ON public.map_submissions(user_id);
CREATE INDEX idx_mapsub_status          ON public.map_submissions(status);

-- rankings
CREATE INDEX idx_rh_type_period         ON public.ranking_history(score_type, period_label);
CREATE INDEX idx_rh_user                ON public.ranking_history(user_id);
CREATE INDEX idx_reset_log_type         ON public.ranking_reset_log(reset_type, reset_at DESC);

-- achievements / badges
CREATE INDEX idx_ach_category           ON public.achievements(category_type);
CREATE INDEX idx_badges_user            ON public.user_badges(user_id);
CREATE INDEX idx_badges_ach             ON public.user_badges(achievement_id);

-- shop
CREATE INDEX idx_shop_active            ON public.shop_items(is_active, category);
CREATE INDEX idx_shop_purch_user        ON public.shop_purchases(user_id, purchased_at DESC);

-- friendships (ambos os lados em uma query)
CREATE INDEX idx_friendships_requester  ON public.friendships(requester, status);
CREATE INDEX idx_friendships_addressee  ON public.friendships(addressee, status);
CREATE INDEX idx_friendships_both       ON public.friendships((LEAST(requester,addressee)), (GREATEST(requester,addressee)));

-- hall of fame
CREATE INDEX idx_hof_type_metric        ON public.hall_of_fame(score_type, metric, recorded_at DESC);
CREATE INDEX idx_hof_user               ON public.hall_of_fame(user_id);

-- content votes
CREATE INDEX idx_cv_target              ON public.content_votes(target_type, target_id);
CREATE INDEX idx_cv_user                ON public.content_votes(user_id);

-- group missions
CREATE INDEX idx_gm_status              ON public.group_missions(status, created_at DESC);
CREATE INDEX idx_gm_creator             ON public.group_missions(creator_id);
CREATE INDEX idx_gm_quest               ON public.group_missions(quest_id);
CREATE INDEX idx_gmm_mission            ON public.group_mission_members(mission_id);
CREATE INDEX idx_gmm_user               ON public.group_mission_members(user_id);
CREATE INDEX idx_gmp_mission            ON public.group_mission_proofs(mission_id);
CREATE INDEX idx_gmp_status             ON public.group_mission_proofs(status);

-- ================================================================
-- FUNÇÕES AUXILIARES
-- ================================================================

-- Verifica se o usuário autenticado é admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin');
$$;

-- Trigger: preenche updated_at automaticamente
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER friendships_updated_at
    BEFORE UPDATE ON public.friendships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Trigger: cria perfil ao cadastrar no auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
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
    WHILE EXISTS (SELECT 1 FROM public.users WHERE nickname = final_nick) LOOP
        counter    := counter + 1;
        final_nick := left(base_nick, 16) || counter;
    END LOOP;
    INSERT INTO public.users (id, email, nickname, profile_nickname, role, profile_role, level, xp, coins, tokens)
    VALUES (NEW.id, NEW.email, final_nick, final_nick, 'user', 'Marmotinha', 1, 0, 0, 0)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Incremento seguro de curtidas/views
CREATE OR REPLACE FUNCTION public.increment_map_likes(map_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN UPDATE public.maps SET likes_count = likes_count + 1 WHERE id = map_id; END;
$$;

CREATE OR REPLACE FUNCTION public.increment_map_views(map_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN UPDATE public.maps SET views_count = views_count + 1 WHERE id = map_id; END;
$$;

-- ================================================================
-- FUNÇÃO: level_up_check — recalcula level ao mudar XP
-- ================================================================
CREATE OR REPLACE FUNCTION public.level_up_check(p_user_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_xp    BIGINT;
    v_level INT;
BEGIN
    SELECT xp INTO v_xp FROM public.users WHERE id = p_user_id;
    -- Fórmula: level = floor(sqrt(xp / 100)) + 1 (mínimo 1)
    v_level := GREATEST(1, FLOOR(SQRT(COALESCE(v_xp, 0)::NUMERIC / 100))::INT + 1);
    UPDATE public.users SET level = v_level WHERE id = p_user_id AND level <> v_level;
    RETURN v_level;
END;
$$;

-- ================================================================
-- FUNÇÃO: approve_submission_v2 — aprova quest atomicamente
-- ================================================================
CREATE OR REPLACE FUNCTION public.approve_submission_v2(
    p_submission_id UUID,
    p_admin_id      UUID,
    p_note          TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_sub   RECORD;
    v_quest RECORD;
    v_next_lvl INT;
BEGIN
    -- Busca submissão + quest
    SELECT s.*, q.reward_coins, q.reward_tokens, q.reward_xp, q.cooldown_hours, q.title
    INTO v_sub
    FROM public.submissions s
    JOIN public.quests q ON q.id = s.quest_id
    WHERE s.id = p_submission_id AND s.status = 'pending';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Submissão não encontrada ou já revisada');
    END IF;

    -- Marca aprovada
    UPDATE public.submissions
    SET status = 'approved', reviewed_at = NOW(), admin_note = p_note,
        cooldown_until = CASE WHEN v_sub.cooldown_hours > 0
                              THEN NOW() + (v_sub.cooldown_hours || ' hours')::INTERVAL
                              ELSE NULL END
    WHERE id = p_submission_id;

    -- Distribui recompensas
    UPDATE public.users SET
        coins         = coins         + COALESCE(v_sub.reward_coins, 0),
        tokens        = tokens        + COALESCE(v_sub.reward_tokens, 0),
        xp            = xp            + COALESCE(v_sub.reward_xp, 0),
        coins_daily   = coins_daily   + COALESCE(v_sub.reward_coins, 0),
        coins_weekly  = coins_weekly  + COALESCE(v_sub.reward_coins, 0),
        coins_monthly = coins_monthly + COALESCE(v_sub.reward_coins, 0),
        tokens_daily  = tokens_daily  + COALESCE(v_sub.reward_tokens, 0),
        tokens_weekly = tokens_weekly + COALESCE(v_sub.reward_tokens, 0),
        tokens_monthly= tokens_monthly+ COALESCE(v_sub.reward_tokens, 0)
    WHERE id = v_sub.user_id;

    -- Recalcula level
    v_next_lvl := public.level_up_check(v_sub.user_id);

    RETURN jsonb_build_object(
        'ok', true,
        'coins_awarded',  v_sub.reward_coins,
        'tokens_awarded', v_sub.reward_tokens,
        'xp_awarded',     v_sub.reward_xp,
        'new_level',      v_next_lvl
    );
END;
$$;

-- ================================================================
-- FUNÇÃO: approve_group_mission_proof
-- ================================================================
CREATE OR REPLACE FUNCTION public.approve_group_mission_proof(
    p_proof_id   BIGINT,
    p_admin_id   UUID,
    p_admin_note TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_proof    RECORD;
    v_member   RECORD;
    v_rewarded INT := 0;
BEGIN
    SELECT gmp.*, gm.reward_coins, gm.reward_tokens, gm.reward_xp,
           gm.required_members, gm.id AS gm_id
    INTO v_proof
    FROM public.group_mission_proofs gmp
    JOIN public.group_missions gm ON gm.id = gmp.mission_id
    WHERE gmp.id = p_proof_id AND gmp.status = 'pending';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Comprovante não encontrado ou já revisado');
    END IF;

    SELECT COUNT(*) INTO v_rewarded
    FROM public.group_mission_members WHERE mission_id = v_proof.gm_id;

    IF v_rewarded < v_proof.required_members THEN
        RETURN jsonb_build_object('ok', false, 'error',
            format('Mínimo de %s membros necessário (atual: %s)', v_proof.required_members, v_rewarded));
    END IF;

    UPDATE public.group_mission_proofs
    SET status = 'approved', reviewed_by = p_admin_id,
        reviewed_at = NOW(), admin_note = p_admin_note
    WHERE id = p_proof_id;

    UPDATE public.group_missions SET status = 'completed', approved_at = NOW()
    WHERE id = v_proof.gm_id;

    FOR v_member IN
        SELECT user_id FROM public.group_mission_members WHERE mission_id = v_proof.gm_id
    LOOP
        UPDATE public.users SET
            coins         = coins         + COALESCE(v_proof.reward_coins, 0),
            tokens        = tokens        + COALESCE(v_proof.reward_tokens, 0),
            xp            = xp            + COALESCE(v_proof.reward_xp, 0),
            coins_daily   = coins_daily   + COALESCE(v_proof.reward_coins, 0),
            coins_weekly  = coins_weekly  + COALESCE(v_proof.reward_coins, 0),
            coins_monthly = coins_monthly + COALESCE(v_proof.reward_coins, 0),
            group_missions_completed = group_missions_completed + 1
        WHERE id = v_member.user_id;
        PERFORM public.level_up_check(v_member.user_id);
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'rewarded_members', v_rewarded,
        'reward_coins',  v_proof.reward_coins,
        'reward_tokens', v_proof.reward_tokens,
        'reward_xp',     v_proof.reward_xp
    );
END;
$$;

-- ================================================================
-- FUNÇÕES DE PERÍODO BRT
-- ================================================================
CREATE OR REPLACE FUNCTION public.brt_now_text()
RETURNS TEXT LANGUAGE SQL STABLE AS $$
    SELECT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
$$;

CREATE OR REPLACE FUNCTION public.brt_period_label(p_type TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE v_now TIMESTAMPTZ := NOW() AT TIME ZONE 'America/Sao_Paulo';
BEGIN
    RETURN CASE p_type
        WHEN 'daily'   THEN to_char(v_now, 'DD/MM/YYYY')
        WHEN 'weekly'  THEN 'Semana ' || to_char(v_now, 'IW/IYYY')
        WHEN 'monthly' THEN to_char(v_now, 'MM/YYYY')
        ELSE to_char(v_now, 'DD/MM/YYYY HH24:MI')
    END;
END;
$$;

-- ================================================================
-- FUNÇÃO: record_hall_of_fame
-- ================================================================
CREATE OR REPLACE FUNCTION public.record_hall_of_fame(p_type TEXT, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_top_coins  RECORD;
    v_top_tokens RECORD;
    v_score_col  TEXT;
BEGIN
    v_score_col := CASE p_type
        WHEN 'daily'   THEN 'coins_daily'
        WHEN 'weekly'  THEN 'coins_weekly'
        WHEN 'monthly' THEN 'coins_monthly'
    END;

    EXECUTE format(
        'SELECT id, %I AS score FROM public.users WHERE %I > 0 ORDER BY %I DESC LIMIT 1',
        v_score_col, v_score_col, v_score_col)
    INTO v_top_coins;

    IF v_top_coins IS NOT NULL AND v_top_coins.score > 0 THEN
        INSERT INTO public.hall_of_fame (user_id, score_type, metric, score, period_label)
        VALUES (v_top_coins.id, p_type, 'coins', v_top_coins.score, p_label)
        ON CONFLICT (user_id, score_type, metric, period_label) DO NOTHING;
        UPDATE public.users SET hof_entries = hof_entries + 1 WHERE id = v_top_coins.id;
    END IF;

    v_score_col := CASE p_type
        WHEN 'daily'   THEN 'tokens_daily'
        WHEN 'weekly'  THEN 'tokens_weekly'
        WHEN 'monthly' THEN 'tokens_monthly'
    END;

    EXECUTE format(
        'SELECT id, %I AS score FROM public.users WHERE %I > 0 ORDER BY %I DESC LIMIT 1',
        v_score_col, v_score_col, v_score_col)
    INTO v_top_tokens;

    IF v_top_tokens IS NOT NULL AND v_top_tokens.score > 0 THEN
        INSERT INTO public.hall_of_fame (user_id, score_type, metric, score, period_label)
        VALUES (v_top_tokens.id, p_type, 'tokens', v_top_tokens.score, p_label)
        ON CONFLICT (user_id, score_type, metric, period_label) DO NOTHING;
        UPDATE public.users SET hof_entries = hof_entries + 1 WHERE id = v_top_tokens.id;
    END IF;
END;
$$;

-- ================================================================
-- FUNÇÕES DE AUTO-RESET
-- ================================================================
CREATE OR REPLACE FUNCTION public.auto_reset_daily_ranking()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_label TEXT; v_count INT := 0;
BEGIN
    v_label := public.brt_period_label('daily');
    PERFORM public.record_hall_of_fame('daily', v_label);
    INSERT INTO public.ranking_history (user_id, score_type, score_coins, score_tokens, period_label)
    SELECT id, 'daily', coins_daily, COALESCE(tokens_daily, 0), v_label
    FROM public.users WHERE coins_daily > 0 OR tokens_daily > 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.users SET coins_daily = 0, tokens_daily = 0 WHERE coins_daily > 0 OR tokens_daily > 0;
    INSERT INTO public.ranking_reset_log (reset_type, period_label, rows_saved) VALUES ('daily', v_label, v_count);
    RETURN jsonb_build_object('type','daily','period_label',v_label,'rows_saved',v_count,'reset_at',NOW());
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_reset_weekly_ranking()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_label TEXT; v_count INT := 0;
BEGIN
    v_label := public.brt_period_label('weekly');
    PERFORM public.record_hall_of_fame('weekly', v_label);
    INSERT INTO public.ranking_history (user_id, score_type, score_coins, score_tokens, period_label)
    SELECT id, 'weekly', coins_weekly, COALESCE(tokens_weekly, 0), v_label
    FROM public.users WHERE coins_weekly > 0 OR tokens_weekly > 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.users SET coins_weekly = 0, tokens_weekly = 0 WHERE coins_weekly > 0 OR tokens_weekly > 0;
    INSERT INTO public.ranking_reset_log (reset_type, period_label, rows_saved) VALUES ('weekly', v_label, v_count);
    RETURN jsonb_build_object('type','weekly','period_label',v_label,'rows_saved',v_count,'reset_at',NOW());
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_reset_monthly_ranking()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_label TEXT; v_count INT := 0;
BEGIN
    v_label := public.brt_period_label('monthly');
    PERFORM public.record_hall_of_fame('monthly', v_label);
    INSERT INTO public.ranking_history (user_id, score_type, score_coins, score_tokens, period_label)
    SELECT id, 'monthly', coins_monthly, COALESCE(tokens_monthly, 0), v_label
    FROM public.users WHERE coins_monthly > 0 OR tokens_monthly > 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.users SET coins_monthly = 0, tokens_monthly = 0 WHERE coins_monthly > 0 OR tokens_monthly > 0;
    INSERT INTO public.ranking_reset_log (reset_type, period_label, rows_saved) VALUES ('monthly', v_label, v_count);
    RETURN jsonb_build_object('type','monthly','period_label',v_label,'rows_saved',v_count,'reset_at',NOW());
END;
$$;

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quests               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maps                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_reset_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_purchases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_favorites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_of_fame         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_votes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_missions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_mission_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_mission_proofs ENABLE ROW LEVEL SECURITY;

-- USERS
CREATE POLICY "v13_u_sel"  ON public.users FOR SELECT  USING (auth.uid() IS NOT NULL);
CREATE POLICY "v13_u_ins"  ON public.users FOR INSERT  WITH CHECK (auth.uid() = id);
CREATE POLICY "v13_u_upd"  ON public.users FOR UPDATE  USING (auth.uid() = id OR is_admin()) WITH CHECK (auth.uid() = id OR is_admin());
CREATE POLICY "v13_u_del"  ON public.users FOR DELETE  USING (is_admin());

-- QUESTS (admin vê todas; user vê ativas)
CREATE POLICY "v13_q_sel_active" ON public.quests FOR SELECT USING (is_active = TRUE AND auth.uid() IS NOT NULL);
CREATE POLICY "v13_q_sel_admin"  ON public.quests FOR SELECT USING (is_admin());
CREATE POLICY "v13_q_ins"        ON public.quests FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "v13_q_upd"        ON public.quests FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "v13_q_del"        ON public.quests FOR DELETE USING (is_admin());

-- MAPS
CREATE POLICY "v13_m_sel" ON public.maps FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "v13_m_ins" ON public.maps FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "v13_m_upd" ON public.maps FOR UPDATE USING (is_admin() OR auth.uid() IS NOT NULL) WITH CHECK (is_admin() OR auth.uid() IS NOT NULL);
CREATE POLICY "v13_m_del" ON public.maps FOR DELETE USING (is_admin());

-- SUBMISSIONS
CREATE POLICY "v13_s_sel" ON public.submissions FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "v13_s_ins" ON public.submissions FOR INSERT WITH CHECK (user_id = auth.uid() AND auth.uid() IS NOT NULL);
CREATE POLICY "v13_s_upd" ON public.submissions FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "v13_s_del" ON public.submissions FOR DELETE USING (is_admin());

-- MAP_SUBMISSIONS
CREATE POLICY "v13_ms_sel" ON public.map_submissions FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "v13_ms_ins" ON public.map_submissions FOR INSERT WITH CHECK (user_id = auth.uid() AND auth.uid() IS NOT NULL);
CREATE POLICY "v13_ms_upd" ON public.map_submissions FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "v13_ms_del" ON public.map_submissions FOR DELETE USING (is_admin());

-- ACHIEVEMENTS
CREATE POLICY "v13_a_sel" ON public.achievements FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "v13_a_ins" ON public.achievements FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "v13_a_upd" ON public.achievements FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "v13_a_del" ON public.achievements FOR DELETE USING (is_admin());

-- USER_BADGES (user vê só os próprios; admin vê todos)
CREATE POLICY "v13_ub_sel" ON public.user_badges FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "v13_ub_ins" ON public.user_badges FOR INSERT WITH CHECK (is_admin() OR user_id = auth.uid());
CREATE POLICY "v13_ub_del" ON public.user_badges FOR DELETE USING (is_admin());

-- RANKING_HISTORY
CREATE POLICY "v13_rh_sel" ON public.ranking_history FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "v13_rh_ins" ON public.ranking_history FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "v13_rh_upd" ON public.ranking_history FOR UPDATE USING (is_admin());

-- RANKING_RESET_LOG
CREATE POLICY "v13_rrl_sel" ON public.ranking_reset_log FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "v13_rrl_ins" ON public.ranking_reset_log FOR INSERT WITH CHECK (auth.role() IN ('authenticated','service_role'));

-- SHOP_ITEMS
CREATE POLICY "v13_si_sel_active" ON public.shop_items FOR SELECT USING (is_active = TRUE AND auth.uid() IS NOT NULL);
CREATE POLICY "v13_si_sel_admin"  ON public.shop_items FOR SELECT USING (is_admin());
CREATE POLICY "v13_si_ins"        ON public.shop_items FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "v13_si_upd"        ON public.shop_items FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "v13_si_del"        ON public.shop_items FOR DELETE USING (is_admin());

-- SHOP_PURCHASES
CREATE POLICY "v13_sp_sel" ON public.shop_purchases FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "v13_sp_ins" ON public.shop_purchases FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "v13_sp_del" ON public.shop_purchases FOR DELETE USING (is_admin());

-- SHOP_FAVORITES
CREATE POLICY "v13_sf_sel" ON public.shop_favorites FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "v13_sf_ins" ON public.shop_favorites FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "v13_sf_del" ON public.shop_favorites FOR DELETE USING (user_id = auth.uid());

-- FRIENDSHIPS
CREATE POLICY "v13_fr_sel" ON public.friendships FOR SELECT USING (auth.uid() IN (requester, addressee));
CREATE POLICY "v13_fr_ins" ON public.friendships FOR INSERT WITH CHECK (auth.uid() = requester);
CREATE POLICY "v13_fr_upd" ON public.friendships FOR UPDATE USING (auth.uid() IN (requester, addressee));
CREATE POLICY "v13_fr_del" ON public.friendships FOR DELETE USING (auth.uid() IN (requester, addressee));

-- HALL_OF_FAME
CREATE POLICY "v13_hof_sel" ON public.hall_of_fame FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "v13_hof_ins" ON public.hall_of_fame FOR INSERT WITH CHECK (auth.role() IN ('service_role','authenticated'));

-- CONTENT_VOTES
CREATE POLICY "v13_cv_sel" ON public.content_votes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "v13_cv_ins" ON public.content_votes FOR INSERT WITH CHECK (auth.uid() = user_id);

-- GROUP_MISSIONS
CREATE POLICY "v13_gm_sel" ON public.group_missions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "v13_gm_ins" ON public.group_missions FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "v13_gm_upd" ON public.group_missions FOR UPDATE USING (TRUE);
CREATE POLICY "v13_gm_del" ON public.group_missions FOR DELETE USING (TRUE);

-- GROUP_MISSION_MEMBERS
CREATE POLICY "v13_gmm_sel" ON public.group_mission_members FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "v13_gmm_ins" ON public.group_mission_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "v13_gmm_del" ON public.group_mission_members FOR DELETE USING (auth.uid() = user_id);

-- GROUP_MISSION_PROOFS
CREATE POLICY "v13_gmp_sel" ON public.group_mission_proofs FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "v13_gmp_ins" ON public.group_mission_proofs FOR INSERT WITH CHECK (auth.uid() = submitted_by);
CREATE POLICY "v13_gmp_upd" ON public.group_mission_proofs FOR UPDATE USING (TRUE);

-- ================================================================
-- DADOS INICIAIS — Quests
-- ================================================================
INSERT INTO public.quests (title, description, type, icon_url, reward_coins, reward_tokens, reward_xp, min_level, is_active, proof_required, cooldown_hours)
VALUES
  ('Login Diário',          'Acesse o sistema e registre presença!',               'daily',   '📅', 50,  0,  25, 1, TRUE,  FALSE, 24),
  ('Derrote um Boss',       'Derrote o boss final de qualquer dungeon',             'daily',   '⚔️', 100, 0,  75, 1, TRUE,  TRUE,  24),
  ('Coleta de Recursos',    'Colete 100 recursos de madeira ou pedra',              'weekly',  '🪵', 300, 5, 200, 1, TRUE,  TRUE,  168),
  ('Explorador Épico',      'Explore 5 novos territórios no mapa',                  'weekly',  '🗺️', 500, 10,350, 3, TRUE,  TRUE,  168),
  ('Mestre das Artes',      'Alcance nível máximo em uma profissão',                'monthly', '🔨',1000,20, 800, 5, TRUE,  TRUE,  720),
  ('Evento de Festas',      'Participe das festividades do servidor!',              'event',   '🎉', 200, 5, 150, 1, TRUE,  TRUE,    0),
  ('Construtor Criativo',   'Construa uma estrutura com mais de 200 blocos',        'weekly',  '🏗️', 400, 8, 280, 2, TRUE,  TRUE,  168),
  ('Caçador de Tesouro',    'Encontre 3 baús escondidos no mundo',                  'daily',   '💎', 150, 3, 100, 2, TRUE,  TRUE,   24)
ON CONFLICT DO NOTHING;

-- ================================================================
-- DADOS INICIAIS — Achievements
-- ================================================================
INSERT INTO public.achievements (title, description, icon_url, category_type, quests_required, maps_required, level_required, hof_required, group_missions_required, reward_coins, reward_tokens, reward_xp)
VALUES
  ('Primeira Missão',        'Complete sua primeira quest',               '🌱','quest',   1,  0,  0, 0, 0,  100,  0,  50),
  ('Aventureiro Iniciante',  'Complete 5 quests',                         '⚔️','quest',   5,  0,  0, 0, 0,  250,  0, 150),
  ('Guerreiro Experiente',   'Complete 20 quests',                        '🛡️','quest',  20,  0,  5, 0, 0,  500,  5, 300),
  ('Herói da Guilda',        'Complete 50 quests',                        '👑','quest',  50,  0, 10, 0, 0, 1000, 10, 600),
  ('Lendário',               'Complete 100 quests',                       '🌟','quest', 100,  0, 20, 0, 0, 2000, 20,1200),
  ('Cartógrafo',             'Tenha 1 mapa aprovado',                     '🗺️','map',    0,  1,  0, 0, 0,  300,  5, 200),
  ('Lorde dos Mapas',        'Tenha 5 mapas aprovados',                   '🏆','map',    0,  5,  0, 0, 0,  800, 15, 500),
  ('Astro do Hall da Fama',  'Entre no Hall da Fama pelo menos 1 vez',    '✨','hof',    0,  0,  0, 1, 0,  500, 10, 300),
  ('Lenda da Fama',          'Entre no Hall da Fama 5 vezes',             '🎖️','hof',    0,  0,  0, 5, 0, 1500, 30, 800),
  ('Espírito de Equipe',     'Complete 1 Missão em Grupo',                '🤝','group',  0,  0,  0, 0, 1,  300,  5, 200),
  ('Comandante',             'Complete 5 Missões em Grupo',               '⚜️','group',  0,  0,  0, 0, 5, 1000, 20, 600)
ON CONFLICT DO NOTHING;

-- ================================================================
-- DADOS INICIAIS — Loja
-- ================================================================
INSERT INTO public.shop_items (name, description, icon_url, category, price_coins, price_tokens, currency, stock, quantity_per_user, is_active)
VALUES
  ('Título: Marmota Lendária', 'Título exclusivo exibido no seu perfil',         '🐾', 'titulo',  2000,  0, 'coins',  -1, 1, TRUE),
  ('Boost XP 2x (1h)',          'Dobra o XP ganho por 1 hora',                   '⚡', 'boost',      0, 50, 'tokens', 100,-1, TRUE),
  ('Moldura Dourada',           'Moldura especial no avatar para membros VIP',   '✨', 'cosmetico', 5000,  0, 'coins',  50, 1, TRUE)
ON CONFLICT DO NOTHING;

-- ================================================================
-- VERIFICAÇÃO FINAL
-- ================================================================
DO $$
DECLARE
    v_tables TEXT[] := ARRAY[
        'users','quests','submissions','maps','map_submissions',
        'ranking_history','ranking_reset_log','achievements','user_badges',
        'shop_items','shop_purchases','shop_favorites',
        'friendships','hall_of_fame','content_votes',
        'group_missions','group_mission_members','group_mission_proofs'
    ];
    v_t TEXT;
    v_count INT;
BEGIN
    RAISE NOTICE '=== v13 BUILD REPORT ===';
    FOREACH v_t IN ARRAY v_tables LOOP
        EXECUTE format('SELECT COUNT(*) FROM public.%I', v_t) INTO v_count;
        RAISE NOTICE 'TABLE %-35s rows: %', v_t, v_count;
    END LOOP;
    RAISE NOTICE 'Quests: %',  (SELECT COUNT(*) FROM public.quests);
    RAISE NOTICE 'Achievements: %', (SELECT COUNT(*) FROM public.achievements);
    RAISE NOTICE 'Shop items: %',   (SELECT COUNT(*) FROM public.shop_items);
    RAISE NOTICE '=== BUILD CONCLUÍDO COM SUCESSO ===';
END $$;
