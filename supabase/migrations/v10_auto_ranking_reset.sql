-- ================================================================
-- MIGRAÇÃO v10 — Toca das Marmotas
-- Auto-reset de rankings (sem pg_cron obrigatório)
--
-- INSTRUÇÕES DE APLICAÇÃO:
--   1. Abra o Supabase Dashboard → SQL Editor
--   2. Cole e execute este script inteiro
--   3. Para verificar a tabela: SELECT * FROM public.ranking_reset_status;
--
-- SEGURANÇA:
--   - Funções usam SECURITY DEFINER para operar com permissões elevadas
--   - NÃO drop e recrie as tabelas — usa CREATE TABLE IF NOT EXISTS
--   - Script é idempotente: pode ser executado novamente sem perda de dados
--
-- NOTA sobre pg_cron:
--   O pg_cron é um add-on disponível no plano Pro do Supabase.
--   Se você não tem pg_cron habilitado, o fallback client-side
--   (checkAndAutoReset) em database.js cobre o auto-reset.
--   Instruções pg_cron ficam no bloco opcional no final do arquivo.
-- ================================================================

-- ── 1. Tabela de controle de auto-reset ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ranking_reset_log (
  id           BIGSERIAL PRIMARY KEY,
  reset_type   TEXT        NOT NULL CHECK (reset_type IN ('daily','weekly','monthly')),
  reset_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_label TEXT,
  rows_saved   INT         DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ranking_reset_log_type_at
  ON public.ranking_reset_log (reset_type, reset_at DESC);

ALTER TABLE public.ranking_reset_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ranking_reset_log_read"  ON public.ranking_reset_log;
DROP POLICY IF EXISTS "ranking_reset_log_write" ON public.ranking_reset_log;
DROP POLICY IF EXISTS "ranking_reset_log_auth_write" ON public.ranking_reset_log;

CREATE POLICY "ranking_reset_log_read"
  ON public.ranking_reset_log FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role', 'anon'));

-- Permite inserção tanto pelo service_role (pg_cron) quanto por autenticados (fallback client)
CREATE POLICY "ranking_reset_log_auth_write"
  ON public.ranking_reset_log FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ── 2. Funções auxiliares de período BRT ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.brt_now_text()
RETURNS TEXT
LANGUAGE SQL STABLE AS $$
  SELECT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY [HH24:MI]');
$$;

CREATE OR REPLACE FUNCTION public.brt_period_label(p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_now    TIMESTAMPTZ := NOW();
  v_brt    TIMESTAMP   := v_now AT TIME ZONE 'America/Sao_Paulo';
  v_label  TEXT;
  v_start  TIMESTAMP;
  v_end    TIMESTAMP;
  v_dow    INT;
  v_diff   INT;
BEGIN
  IF p_type = 'daily' THEN
    v_start := date_trunc('day', v_brt);
    v_end   := v_start + INTERVAL '1 day' - INTERVAL '1 second';

  ELSIF p_type = 'weekly' THEN
    v_dow  := EXTRACT(DOW FROM v_brt)::INT;
    v_diff := CASE WHEN v_dow = 0 THEN -6 ELSE 1 - v_dow END;
    v_start := date_trunc('day', v_brt) + (v_diff || ' days')::INTERVAL;
    v_end   := v_start + INTERVAL '7 days' - INTERVAL '1 second';

  ELSIF p_type = 'monthly' THEN
    v_start := date_trunc('month', v_brt);
    v_end   := (date_trunc('month', v_brt) + INTERVAL '1 month') - INTERVAL '1 second';

  ELSE
    RETURN NULL;
  END IF;

  v_label := to_char(v_start, 'DD/MM/YYYY [HH24:MI]')
    || ' até '
    || to_char(v_end,   'DD/MM/YYYY [HH24:MI]')
    || ' BRT';
  RETURN v_label;
END;
$$;

-- ── 3. Funções de reset com log automático ────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_reset_daily_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_label  TEXT;
  v_count  INT := 0;
BEGIN
  v_label := public.brt_period_label('daily');

  INSERT INTO public.ranking_history (user_id, score_type, score_coins, score_tokens, period_label)
  SELECT id, 'daily', coins_daily, COALESCE(tokens_daily, 0), v_label
  FROM public.users
  WHERE coins_daily > 0 OR tokens_daily > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.users
  SET coins_daily = 0, tokens_daily = 0
  WHERE coins_daily > 0 OR tokens_daily > 0;

  INSERT INTO public.ranking_reset_log (reset_type, period_label, rows_saved)
  VALUES ('daily', v_label, v_count);

  RETURN jsonb_build_object('type','daily','period_label',v_label,'rows_saved',v_count,'reset_at',NOW());
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_reset_weekly_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_label  TEXT;
  v_count  INT := 0;
BEGIN
  v_label := public.brt_period_label('weekly');

  INSERT INTO public.ranking_history (user_id, score_type, score_coins, score_tokens, period_label)
  SELECT id, 'weekly', coins_weekly, COALESCE(tokens_weekly, 0), v_label
  FROM public.users
  WHERE coins_weekly > 0 OR tokens_weekly > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.users
  SET coins_weekly = 0, tokens_weekly = 0
  WHERE coins_weekly > 0 OR tokens_weekly > 0;

  INSERT INTO public.ranking_reset_log (reset_type, period_label, rows_saved)
  VALUES ('weekly', v_label, v_count);

  RETURN jsonb_build_object('type','weekly','period_label',v_label,'rows_saved',v_count,'reset_at',NOW());
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_reset_monthly_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_label  TEXT;
  v_count  INT := 0;
BEGIN
  v_label := public.brt_period_label('monthly');

  INSERT INTO public.ranking_history (user_id, score_type, score_coins, score_tokens, period_label)
  SELECT id, 'monthly', coins_monthly, COALESCE(tokens_monthly, 0), v_label
  FROM public.users
  WHERE coins_monthly > 0 OR tokens_monthly > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.users
  SET coins_monthly = 0, tokens_monthly = 0
  WHERE coins_monthly > 0 OR tokens_monthly > 0;

  INSERT INTO public.ranking_reset_log (reset_type, period_label, rows_saved)
  VALUES ('monthly', v_label, v_count);

  RETURN jsonb_build_object('type','monthly','period_label',v_label,'rows_saved',v_count,'reset_at',NOW());
END;
$$;

-- ── 4. View helpers para consultas rápidas ────────────────────────────────

CREATE OR REPLACE VIEW public.ranking_reset_status AS
SELECT DISTINCT ON (reset_type)
  reset_type,
  reset_at,
  period_label,
  rows_saved
FROM public.ranking_reset_log
ORDER BY reset_type, reset_at DESC;

-- ── 5. Índices de performance no ranking_history ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_ranking_history_type_period
  ON public.ranking_history (score_type, period_label DESC, score_coins DESC);

CREATE INDEX IF NOT EXISTS idx_ranking_history_type_tokens
  ON public.ranking_history (score_type, period_label DESC, score_tokens DESC);

-- ── 6. [OPCIONAL] Agendar via pg_cron (somente Supabase Pro) ─────────────
--
-- Se o seu plano Supabase tem pg_cron habilitado, execute os blocos
-- abaixo SEPARADAMENTE no SQL Editor (não junto com o script acima,
-- pois causará erro "schema cron does not exist" se não estiver ativo).
--
-- Verifique se pg_cron está ativo:
--   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
--
-- Se estiver ativo, execute cada linha individualmente:
--
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'toca-reset-daily';
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'toca-reset-weekly';
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'toca-reset-monthly';
--
--   SELECT cron.schedule('toca-reset-daily',   '45 4 * * *',   $$SELECT public.auto_reset_daily_ranking();$$);
--   SELECT cron.schedule('toca-reset-weekly',  '50 4 * * 1',   $$SELECT public.auto_reset_weekly_ranking();$$);
--   SELECT cron.schedule('toca-reset-monthly', '55 4 1 * *',   $$SELECT public.auto_reset_monthly_ranking();$$);
--
-- ── FIM DA MIGRAÇÃO v10 ───────────────────────────────────────────────────
-- Após executar, verifique:
--   SELECT * FROM public.ranking_reset_status;
--   SELECT COUNT(*) FROM public.ranking_reset_log;
