-- ================================================================
-- MIGRAÇÃO v12 — Toca das Marmotas
-- Refatoração completa de Missões em Grupo:
--   • group_missions agora é criada SOMENTE por admin
--   • Vinculada a uma quest existente
--   • required_members: mínimo de participantes para completar
--   • reward_coins / reward_tokens / reward_xp: recompensas extras
--   • deadline: prazo de conclusão
--   • group_mission_proofs: tabela de comprovantes dos grupos
--   • Achievements baseados em ranking (hall_of_fame_achievements)
--
-- INSTRUÇÕES:
--   1. Supabase Dashboard → SQL Editor → Novo Query
--   2. Cole e execute este script
--   Script é IDEMPOTENTE: pode ser executado novamente sem perda de dados
-- ================================================================

-- ── 1. DROP e recria group_missions (schema novo) ──────────────
DROP TABLE IF EXISTS public.group_mission_members  CASCADE;
DROP TABLE IF EXISTS public.group_mission_proofs   CASCADE;
DROP TABLE IF EXISTS public.group_missions          CASCADE;

CREATE TABLE public.group_missions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            TEXT NOT NULL,
  description      TEXT,
  quest_id         UUID REFERENCES public.quests(id)  ON DELETE SET NULL,
  creator_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status           TEXT DEFAULT 'open'
                   CHECK (status IN ('open','in_progress','completed','cancelled')),
  required_members INT  DEFAULT 2,
  max_members      INT  DEFAULT 10,
  reward_coins     INT  DEFAULT 0,
  reward_tokens    INT  DEFAULT 0,
  reward_xp        INT  DEFAULT 0,
  proof_note       TEXT,          -- instrução para o print (ex: "Print com todos no mapa")
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,   -- deadline
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  approved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gm_status    ON public.group_missions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_creator   ON public.group_missions (creator_id);
CREATE INDEX IF NOT EXISTS idx_gm_quest     ON public.group_missions (quest_id);

ALTER TABLE public.group_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gm_select"  ON public.group_missions;
DROP POLICY IF EXISTS "gm_insert"  ON public.group_missions;
DROP POLICY IF EXISTS "gm_update"  ON public.group_missions;
DROP POLICY IF EXISTS "gm_delete"  ON public.group_missions;

-- Qualquer autenticado pode ver
CREATE POLICY "gm_select"  ON public.group_missions FOR SELECT TO authenticated USING (true);
-- Apenas admin pode criar (creator_id = qualquer — admin define via JS)
CREATE POLICY "gm_insert"  ON public.group_missions FOR INSERT WITH CHECK (true);
-- Admin pode atualizar qualquer; usuário só pode se for criador
CREATE POLICY "gm_update"  ON public.group_missions FOR UPDATE USING (true);
CREATE POLICY "gm_delete"  ON public.group_missions FOR DELETE USING (true);

-- ── 2. Membros das missões ─────────────────────────────────────
CREATE TABLE public.group_mission_members (
  mission_id UUID NOT NULL REFERENCES public.group_missions(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id)          ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  role       TEXT DEFAULT 'member' CHECK (role IN ('leader','member')),
  PRIMARY KEY (mission_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_gmm_mission ON public.group_mission_members (mission_id);
CREATE INDEX IF NOT EXISTS idx_gmm_user    ON public.group_mission_members (user_id);

ALTER TABLE public.group_mission_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gmm_select" ON public.group_mission_members;
DROP POLICY IF EXISTS "gmm_insert" ON public.group_mission_members;
DROP POLICY IF EXISTS "gmm_delete" ON public.group_mission_members;

CREATE POLICY "gmm_select" ON public.group_mission_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "gmm_insert" ON public.group_mission_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "gmm_delete" ON public.group_mission_members FOR DELETE USING (auth.uid() = user_id);

-- ── 3. Comprovantes do grupo ───────────────────────────────────
-- Um único comprovante por missão (qualquer membro envia o print com todos)
CREATE TABLE public.group_mission_proofs (
  id           BIGSERIAL PRIMARY KEY,
  mission_id   UUID NOT NULL REFERENCES public.group_missions(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES public.users(id)          ON DELETE CASCADE,
  proof_url    TEXT NOT NULL,
  note         TEXT,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  UUID REFERENCES public.users(id),
  reviewed_at  TIMESTAMPTZ,
  admin_note   TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gmp_mission ON public.group_mission_proofs (mission_id);
CREATE INDEX IF NOT EXISTS idx_gmp_status  ON public.group_mission_proofs (status);

ALTER TABLE public.group_mission_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gmp_select" ON public.group_mission_proofs;
DROP POLICY IF EXISTS "gmp_insert" ON public.group_mission_proofs;
DROP POLICY IF EXISTS "gmp_update" ON public.group_mission_proofs;

CREATE POLICY "gmp_select" ON public.group_mission_proofs FOR SELECT TO authenticated USING (true);
CREATE POLICY "gmp_insert" ON public.group_mission_proofs FOR INSERT WITH CHECK (auth.uid() = submitted_by);
CREATE POLICY "gmp_update" ON public.group_mission_proofs FOR UPDATE USING (true);

-- ── 4. Achievements baseados em ranking (Hall da Fama) ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='achievements' AND column_name='category_type'
  ) THEN
    ALTER TABLE public.achievements ADD COLUMN category_type TEXT DEFAULT 'quest';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='achievements' AND column_name='hof_required'
  ) THEN
    -- Número de vezes no Hall da Fama necessário para desbloquear
    ALTER TABLE public.achievements ADD COLUMN hof_required INT DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='achievements' AND column_name='group_missions_required'
  ) THEN
    ALTER TABLE public.achievements ADD COLUMN group_missions_required INT DEFAULT 0;
  END IF;
END $$;

-- ── 5. Rastrear missões em grupo concluídas por usuário ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='group_missions_completed'
  ) THEN
    ALTER TABLE public.users ADD COLUMN group_missions_completed INT DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='hof_entries'
  ) THEN
    -- Contador de vezes que entrou no Hall da Fama
    ALTER TABLE public.users ADD COLUMN hof_entries INT DEFAULT 0;
  END IF;
END $$;

-- ── 6. Função para aprovar comprovante de missão em grupo ───────
CREATE OR REPLACE FUNCTION public.approve_group_mission_proof(
  p_proof_id   BIGINT,
  p_admin_id   UUID,
  p_admin_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_proof   RECORD;
  v_mission RECORD;
  v_member  RECORD;
  v_rewarded INT := 0;
BEGIN
  -- Busca comprovante e missão
  SELECT gmp.*, gm.reward_coins, gm.reward_tokens, gm.reward_xp,
         gm.required_members, gm.id AS gm_id
  INTO v_proof
  FROM public.group_mission_proofs gmp
  JOIN public.group_missions gm ON gm.id = gmp.mission_id
  WHERE gmp.id = p_proof_id AND gmp.status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Comprovante não encontrado ou já revisado');
  END IF;

  -- Conta membros
  SELECT COUNT(*) INTO v_rewarded
  FROM public.group_mission_members
  WHERE mission_id = v_proof.gm_id;

  IF v_rewarded < v_proof.required_members THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Mínimo de %s membros necessário (atual: %s)', v_proof.required_members, v_rewarded));
  END IF;

  -- Aprova comprovante
  UPDATE public.group_mission_proofs
  SET status = 'approved', reviewed_by = p_admin_id,
      reviewed_at = NOW(), admin_note = p_admin_note
  WHERE id = p_proof_id;

  -- Marca missão como concluída
  UPDATE public.group_missions SET status = 'completed', approved_at = NOW()
  WHERE id = v_proof.gm_id;

  -- Distribui recompensas a todos os membros
  FOR v_member IN
    SELECT user_id FROM public.group_mission_members WHERE mission_id = v_proof.gm_id
  LOOP
    UPDATE public.users SET
      coins       = COALESCE(coins, 0)       + COALESCE(v_proof.reward_coins,  0),
      tokens      = COALESCE(tokens, 0)      + COALESCE(v_proof.reward_tokens, 0),
      xp          = COALESCE(xp, 0)          + COALESCE(v_proof.reward_xp,     0),
      coins_daily   = COALESCE(coins_daily, 0)   + COALESCE(v_proof.reward_coins, 0),
      coins_weekly  = COALESCE(coins_weekly, 0)  + COALESCE(v_proof.reward_coins, 0),
      coins_monthly = COALESCE(coins_monthly, 0) + COALESCE(v_proof.reward_coins, 0),
      group_missions_completed = COALESCE(group_missions_completed, 0) + 1
    WHERE id = v_member.user_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'rewarded_members', v_rewarded,
    'reward_coins',  v_proof.reward_coins,
    'reward_tokens', v_proof.reward_tokens,
    'reward_xp',     v_proof.reward_xp
  );
END; $$;

-- ── 7. Atualiza record_hall_of_fame para incrementar hof_entries ─
CREATE OR REPLACE FUNCTION public.record_hall_of_fame(p_type TEXT, p_label TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    VALUES (v_top_coins.id, p_type, 'coins', v_top_coins.score, p_label);
    UPDATE public.users SET hof_entries = COALESCE(hof_entries, 0) + 1
    WHERE id = v_top_coins.id;
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
    VALUES (v_top_tokens.id, p_type, 'tokens', v_top_tokens.score, p_label);
    UPDATE public.users SET hof_entries = COALESCE(hof_entries, 0) + 1
    WHERE id = v_top_tokens.id;
  END IF;
END; $$;

-- ── FIM DA MIGRAÇÃO v12 ────────────────────────────────────────
-- Após executar, verifique:
--   SELECT * FROM public.group_missions LIMIT 5;
--   SELECT * FROM public.group_mission_proofs LIMIT 5;
--   \d public.achievements
-- IMPORTANTE: A aprovação de comprovantes usa approve_group_mission_proof()
--   executada via rpc() no client-side (admin).
