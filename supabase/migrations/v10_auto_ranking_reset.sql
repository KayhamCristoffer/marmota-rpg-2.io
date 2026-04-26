-- ================================================================
-- MIGRAÇÃO v10 — Toca das Marmotas
-- Auto-reset de rankings via pg_cron (Supabase)
--
-- INSTRUÇÕES DE APLICAÇÃO:
--   1. Abra o Supabase Dashboard → SQL Editor
--   2. Cole e execute este script inteiro
--   3. Para verificar jobs: SELECT * FROM cron.job;
--   4. Para ver histórico de execuções: SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- SEGURANÇA:
--   - As funções usam SECURITY DEFINER para operar com permissões elevadas
--   - Somente o owner do banco pode criar/alterar cron jobs
--   - NÃO drop e recrie as tabelas — use UPDATE/INSERT para preservar dados
-- ================================================================

-- ── 1. Habilitar extensão pg_cron (já vem habilitada no Supabase) ──────────
-- Se não estiver habilitada, vá em Database → Extensions → pg_cron → Enable
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 2. Tabela de controle de auto-reset ───────────────────────────────────
-- Armazena quando cada tipo de ranking foi resetado automaticamente pela última vez.
-- Usamos INSERT com ON CONFLICT para não destruir dados existentes.
CREATE TABLE IF NOT EXISTS public.ranking_reset_log (
  id           BIGSERIAL PRIMARY KEY,
  reset_type   TEXT        NOT NULL CHECK (reset_type IN ('daily','weekly','monthly')),
  reset_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_label TEXT,
  rows_saved   INT         DEFAULT 0
);

-- Índice para consultas rápidas do último reset por tipo
CREATE INDEX IF NOT EXISTS idx_ranking_reset_log_type_at
  ON public.ranking_reset_log (reset_type, reset_at DESC);

-- RLS: somente service_role escreve, qualquer autenticado lê
ALTER TABLE public.ranking_reset_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ranking_reset_log_read"  ON public.ranking_reset_log;
DROP POLICY IF EXISTS "ranking_reset_log_write" ON public.ranking_reset_log;

CREATE POLICY "ranking_reset_log_read"
  ON public.ranking_reset_log FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "ranking_reset_log_write"
  ON public.ranking_reset_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ── 3. Funções auxiliares de período BRT ──────────────────────────────────

-- Retorna o horário atual em BRT (UTC-3) como texto formatado
CREATE OR REPLACE FUNCTION public.brt_now_text()
RETURNS TEXT
LANGUAGE SQL STABLE AS $$
  SELECT to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY [HH24:MI]');
$$;

-- Retorna label de período para o histórico no formato BRT
CREATE OR REPLACE FUNCTION public.brt_period_label(p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_now    TIMESTAMPTZ := NOW();
  v_brt    TIMESTAMP   := v_now AT TIME ZONE 'America/Sao_Paulo';
  v_label  TEXT;
  v_start  TIMESTAMP;
  v_end    TIMESTAMP;
  v_dow    INT; -- 0=domingo, 1=segunda ... 6=sábado
  v_diff   INT;
BEGIN
  IF p_type = 'daily' THEN
    v_start := date_trunc('day', v_brt);
    v_end   := v_start + INTERVAL '1 day' - INTERVAL '1 second';

  ELSIF p_type = 'weekly' THEN
    -- Semana começa na segunda-feira (dow=1)
    v_dow  := EXTRACT(DOW FROM v_brt)::INT; -- 0=dom
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

-- ── 4. Funções de reset com log automático ────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_reset_daily_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_label  TEXT;
  v_count  INT := 0;
  v_result JSONB;
BEGIN
  v_label := public.brt_period_label('daily');

  -- Salvar histórico de quem tinha pontos no período
  INSERT INTO public.ranking_history (user_id, score_type, score_coins, score_tokens, period_label)
  SELECT id, 'daily', coins_daily, COALESCE(tokens_daily, 0), v_label
  FROM public.users
  WHERE coins_daily > 0 OR tokens_daily > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Zerar contadores diários
  UPDATE public.users
  SET coins_daily = 0, tokens_daily = 0
  WHERE coins_daily > 0 OR tokens_daily > 0;

  -- Registrar log do auto-reset
  INSERT INTO public.ranking_reset_log (reset_type, period_label, rows_saved)
  VALUES ('daily', v_label, v_count);

  v_result := jsonb_build_object(
    'type', 'daily',
    'period_label', v_label,
    'rows_saved', v_count,
    'reset_at', NOW()
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_reset_weekly_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_label  TEXT;
  v_count  INT := 0;
  v_result JSONB;
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

  RETURN jsonb_build_object(
    'type', 'weekly',
    'period_label', v_label,
    'rows_saved', v_count,
    'reset_at', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_reset_monthly_ranking()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_label  TEXT;
  v_count  INT := 0;
  v_result JSONB;
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

  RETURN jsonb_build_object(
    'type', 'monthly',
    'period_label', v_label,
    'rows_saved', v_count,
    'reset_at', NOW()
  );
END;
$$;

-- ── 5. Grant de execução (necessário para o cron chamar como postgres) ────
GRANT EXECUTE ON FUNCTION public.auto_reset_daily_ranking()   TO postgres;
GRANT EXECUTE ON FUNCTION public.auto_reset_weekly_ranking()  TO postgres;
GRANT EXECUTE ON FUNCTION public.auto_reset_monthly_ranking() TO postgres;

-- ── 6. Agendar jobs via pg_cron ───────────────────────────────────────────
-- pg_cron usa UTC internamente. BRT = UTC-3.
-- Reset diário:   04:45 UTC  = 01:45 BRT  (todo dia)
-- Reset semanal:  04:50 UTC  = 01:50 BRT  (segunda-feira)
-- Reset mensal:   04:55 UTC  = 01:55 BRT  (dia 1 de cada mês)

-- Remove jobs antigos se existirem (para recriar limpo)
SELECT cron.unschedule('toca-reset-daily')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toca-reset-daily');
SELECT cron.unschedule('toca-reset-weekly')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toca-reset-weekly');
SELECT cron.unschedule('toca-reset-monthly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toca-reset-monthly');

-- Agenda reset DIÁRIO — todo dia às 01:45 BRT (04:45 UTC)
SELECT cron.schedule(
  'toca-reset-daily',
  '45 4 * * *',
  $$SELECT public.auto_reset_daily_ranking();$$
);

-- Agenda reset SEMANAL — segunda-feira às 01:50 BRT (04:50 UTC)
SELECT cron.schedule(
  'toca-reset-weekly',
  '50 4 * * 1',
  $$SELECT public.auto_reset_weekly_ranking();$$
);

-- Agenda reset MENSAL — dia 1 de cada mês às 01:55 BRT (04:55 UTC)
SELECT cron.schedule(
  'toca-reset-monthly',
  '55 4 1 * *',
  $$SELECT public.auto_reset_monthly_ranking();$$
);

-- ── 7. Verificar agendamentos criados ─────────────────────────────────────
-- Execute esta query para confirmar:
-- SELECT jobid, jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'toca-%';

-- ── 8. Índice de performance no ranking_history ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_ranking_history_type_period
  ON public.ranking_history (score_type, period_label DESC, score_coins DESC);

CREATE INDEX IF NOT EXISTS idx_ranking_history_type_tokens
  ON public.ranking_history (score_type, period_label DESC, score_tokens DESC);

-- ── 9. View helpers para consultas rápidas ────────────────────────────────
-- Retorna o último reset de cada tipo
CREATE OR REPLACE VIEW public.ranking_reset_status AS
SELECT DISTINCT ON (reset_type)
  reset_type,
  reset_at,
  period_label,
  rows_saved
FROM public.ranking_reset_log
ORDER BY reset_type, reset_at DESC;

-- ── FIM DA MIGRAÇÃO v10 ───────────────────────────────────────────────────
-- Após executar, verifique:
--   SELECT * FROM cron.job WHERE jobname LIKE 'toca-%';
--   SELECT * FROM public.ranking_reset_status;
