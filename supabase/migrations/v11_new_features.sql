-- ================================================================
-- MIGRAÇÃO v11 — Toca das Marmotas
-- Novas funcionalidades: Amizades, Missões em Grupo, Moderação de
-- Conteúdo, Hall da Fama e Perfis Públicos
--
-- INSTRUÇÕES:
--   1. Supabase Dashboard → SQL Editor → Novo Query
--   2. Cole e execute este script
--   Script é IDEMPOTENTE: pode ser executado novamente sem perda de dados
-- ================================================================

-- ── 1. AMIZADES / SEGUIDORES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.friendships (
  id          BIGSERIAL PRIMARY KEY,
  requester   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','accepted','blocked')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (requester, addressee)
);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships (requester, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships (addressee, status);
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "friendships_select" ON public.friendships;
DROP POLICY IF EXISTS "friendships_insert" ON public.friendships;
DROP POLICY IF EXISTS "friendships_update" ON public.friendships;
DROP POLICY IF EXISTS "friendships_delete" ON public.friendships;
CREATE POLICY "friendships_select" ON public.friendships FOR SELECT USING (auth.uid() IN (requester, addressee));
CREATE POLICY "friendships_insert" ON public.friendships FOR INSERT WITH CHECK (auth.uid() = requester);
CREATE POLICY "friendships_update" ON public.friendships FOR UPDATE USING (auth.uid() IN (requester, addressee));
CREATE POLICY "friendships_delete" ON public.friendships FOR DELETE USING (auth.uid() IN (requester, addressee));

-- ── 2. MISSÕES EM GRUPO ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_missions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT NOT NULL,
  description  TEXT,
  quest_id     UUID REFERENCES public.quests(id) ON DELETE SET NULL,
  creator_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  max_members  INT DEFAULT 4,
  reward_bonus_pct INT DEFAULT 10,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_missions_status ON public.group_missions (status, created_at DESC);
ALTER TABLE public.group_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "group_missions_select" ON public.group_missions;
DROP POLICY IF EXISTS "group_missions_insert" ON public.group_missions;
DROP POLICY IF EXISTS "group_missions_update" ON public.group_missions;
CREATE POLICY "group_missions_select" ON public.group_missions FOR SELECT TO authenticated USING (true);
CREATE POLICY "group_missions_insert" ON public.group_missions FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "group_missions_update" ON public.group_missions FOR UPDATE USING (auth.uid() = creator_id);

-- ── 3. MEMBROS DE MISSÕES EM GRUPO ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_mission_members (
  mission_id UUID NOT NULL REFERENCES public.group_missions(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  role       TEXT DEFAULT 'member' CHECK (role IN ('leader','member')),
  PRIMARY KEY (mission_id, user_id)
);
ALTER TABLE public.group_mission_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gmm_select" ON public.group_mission_members;
DROP POLICY IF EXISTS "gmm_insert" ON public.group_mission_members;
DROP POLICY IF EXISTS "gmm_delete" ON public.group_mission_members;
CREATE POLICY "gmm_select" ON public.group_mission_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "gmm_insert" ON public.group_mission_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gmm_delete" ON public.group_mission_members FOR DELETE USING (auth.uid() = user_id);

-- ── 4. VOTOS DE MODERAÇÃO DE CONTEÚDO ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_votes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('map','quest','submission')),
  target_id   TEXT NOT NULL,
  vote        TEXT NOT NULL CHECK (vote IN ('approve','reject','flag')),
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_content_votes_target ON public.content_votes (target_type, target_id);
ALTER TABLE public.content_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "content_votes_select" ON public.content_votes;
DROP POLICY IF EXISTS "content_votes_insert" ON public.content_votes;
CREATE POLICY "content_votes_select" ON public.content_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "content_votes_insert" ON public.content_votes FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── 5. HALL DA FAMA ───────────────────────────────────────────────────────
-- Registra automaticamente o 1º lugar de cada período de ranking
CREATE TABLE IF NOT EXISTS public.hall_of_fame (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  score_type   TEXT NOT NULL CHECK (score_type IN ('daily','weekly','monthly')),
  metric       TEXT NOT NULL DEFAULT 'coins' CHECK (metric IN ('coins','tokens')),
  score        BIGINT NOT NULL DEFAULT 0,
  period_label TEXT,
  recorded_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hall_of_fame_type ON public.hall_of_fame (score_type, metric, recorded_at DESC);
ALTER TABLE public.hall_of_fame ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hall_of_fame_select" ON public.hall_of_fame;
DROP POLICY IF EXISTS "hall_of_fame_insert" ON public.hall_of_fame;
CREATE POLICY "hall_of_fame_select" ON public.hall_of_fame FOR SELECT TO authenticated USING (true);
CREATE POLICY "hall_of_fame_insert" ON public.hall_of_fame FOR INSERT WITH CHECK (auth.role() IN ('service_role','authenticated'));

-- ── 6. PERFIS PÚBLICOS / SLUG ──────────────────────────────────────────────
-- Adiciona coluna de slug público ao users (se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='public_profile') THEN
    ALTER TABLE public.users ADD COLUMN public_profile BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='profile_bio') THEN
    ALTER TABLE public.users ADD COLUMN profile_bio TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='social_links') THEN
    ALTER TABLE public.users ADD COLUMN social_links JSONB DEFAULT '{}';
  END IF;
END $$;

-- ── 7. Função que popula Hall da Fama ao fazer reset ──────────────────────
CREATE OR REPLACE FUNCTION public.record_hall_of_fame(p_type TEXT, p_label TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_top_coins RECORD;
  v_top_tokens RECORD;
  v_score_col TEXT;
BEGIN
  v_score_col := CASE p_type
    WHEN 'daily'   THEN 'coins_daily'
    WHEN 'weekly'  THEN 'coins_weekly'
    WHEN 'monthly' THEN 'coins_monthly'
  END;

  -- Top moedas
  EXECUTE format('SELECT id, %I AS score FROM public.users WHERE %I > 0 ORDER BY %I DESC LIMIT 1', v_score_col, v_score_col, v_score_col)
  INTO v_top_coins;

  IF v_top_coins IS NOT NULL AND v_top_coins.score > 0 THEN
    INSERT INTO public.hall_of_fame (user_id, score_type, metric, score, period_label)
    VALUES (v_top_coins.id, p_type, 'coins', v_top_coins.score, p_label);
  END IF;

  -- Top tokens
  v_score_col := CASE p_type
    WHEN 'daily'   THEN 'tokens_daily'
    WHEN 'weekly'  THEN 'tokens_weekly'
    WHEN 'monthly' THEN 'tokens_monthly'
  END;

  EXECUTE format('SELECT id, %I AS score FROM public.users WHERE %I > 0 ORDER BY %I DESC LIMIT 1', v_score_col, v_score_col, v_score_col)
  INTO v_top_tokens;

  IF v_top_tokens IS NOT NULL AND v_top_tokens.score > 0 THEN
    INSERT INTO public.hall_of_fame (user_id, score_type, metric, score, period_label)
    VALUES (v_top_tokens.id, p_type, 'tokens', v_top_tokens.score, p_label);
  END IF;
END;
$$;

-- ── 8. Atualiza funções de reset para também registrar Hall da Fama ───────
CREATE OR REPLACE FUNCTION public.auto_reset_daily_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
END; $$;

CREATE OR REPLACE FUNCTION public.auto_reset_weekly_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
END; $$;

CREATE OR REPLACE FUNCTION public.auto_reset_monthly_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
END; $$;

-- ── FIM DA MIGRAÇÃO v11 ───────────────────────────────────────────────────
-- Após executar, verifique:
--   SELECT * FROM public.hall_of_fame LIMIT 5;
--   SELECT * FROM public.group_missions LIMIT 5;
--   \d public.friendships
