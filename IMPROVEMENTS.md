# Toca das Marmotas — Melhorias & Sugestões v13

> Documento técnico com análise do estado atual, melhorias implementadas e roadmap de evolução.

---

## ✅ Melhorias Implementadas na v13 (full_rebuild)

### 🔒 Integridade de Dados (Constraints)
| Problema anterior | Solução v13 |
|---|---|
| `nickname` sem limite mínimo | `CHECK (char_length(nickname) BETWEEN 3 AND 30)` |
| `coins/tokens/xp` podiam ficar negativos | `CHECK (coins >= 0)`, `CHECK (xp >= 0)`, etc. |
| `level` podia ser 0 ou negativo | `CHECK (level >= 1)` |
| HoF aceitava entradas duplicadas no mesmo período | `UNIQUE (user_id, score_type, metric, period_label)` |
| `group_mission_proofs`: múltiplos comprovantes por missão | `UNIQUE (mission_id)` — um comprovante por missão |
| `min_members > required_members` era permitido | `CONSTRAINT chk_gm_members CHECK (min <= required <= max)` |
| Amizade consigo mesmo (`requester = addressee`) | `CONSTRAINT chk_no_self_friendship CHECK (requester <> addressee)` |
| Rewards podiam ser negativos nas tabelas | `CHECK (reward_coins >= 0)`, `CHECK (price_coins >= 0)` etc. |

### 🚀 Performance (Índices)
| Índice adicionado | Benefício |
|---|---|
| `idx_users_nickname_trgm` (pg_trgm GIN) | Busca por similaridade de nickname até 10× mais rápida |
| `idx_users_public` (WHERE public_profile=TRUE) | Filtro parcial para buscar perfis públicos |
| `idx_users_level` | Ordenação por nível no ranking |
| `idx_friendships_both` com LEAST/GREATEST | Query "amigos em comum" sem varrer as 2 direções |
| `idx_maps_featured` (WHERE is_featured=TRUE) | Mapas em destaque sem full-scan |
| `idx_maps_likes` | Ordenação por curtidas |
| `idx_subs_cooldown` (user_id, quest_id, cooldown_until) | Verificação de cooldown em O(log n) |

### 🧱 Novas Colunas e Tabelas
- **`quests.reward_tokens`** — quests agora distribuem tokens além de coins
- **`quests.image_required`** — diferencia prova de imagem de prova textual
- **`maps.submitted_by_nick`** — snapshot do nickname ao enviar (resiste ao delete do user)
- **`maps.is_featured`** — flag para mapas em destaque
- **`shop_items.quantity_per_user`** — limita compras por usuário (`-1` = sem limite)
- **`users.*` colunas** já unificadas com v11/v12: `public_profile`, `profile_bio`, `social_links`, `group_missions_completed`, `hof_entries`

### ⚙️ Funções Novas/Melhoradas
| Função | Descrição |
|---|---|
| `level_up_check(user_id)` | Recalcula level após ganhar XP (chamada atômica) |
| `approve_submission_v2(sub_id, admin_id, note)` | Aprova quest + distribui recompensas + recalcula level em 1 transação |
| `approve_group_mission_proof` (melhorada) | Chama `level_up_check` para cada membro após distribuir XP |
| `record_hall_of_fame` (melhorada) | `ON CONFLICT DO NOTHING` evita duplicatas no HoF |
| `auto_reset_*` (3 funções) | Incorporadas diretamente no v13 (sem depender de migration separada) |
| `brt_period_label` + `brt_now_text` | Funções de período BRT integradas no rebuild |

---

## 🗺️ Roadmap de Evolução (Sugestões Futuras)

### 🔴 Alta Prioridade

#### 1. Notificações em Tempo Real
**Problema:** Usuários não sabem quando uma submission foi aprovada, uma amizade aceita ou uma missão completada.

**Solução sugerida:**
```sql
CREATE TABLE public.notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'submission_approved','submission_rejected',
                'friend_request','friend_accepted',
                'mission_completed','badge_earned','level_up'
              )),
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,          -- URL para navegar ao clicar
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```
**Implementação JS:** usar `supabase.channel('notifications').on('postgres_changes', ...)` já disponível no Supabase Realtime.

---

#### 2. Sistema de Cooldown no Banco (não só no cliente)
**Problema:** O cooldown de quests é verificado apenas no front-end (`database.js`), o que permite submissões duplicadas se o usuário manipular o client.

**Solução sugerida:**
```sql
-- Em approve_submission_v2: verificar se já existe submission aprovada no cooldown
SELECT 1 FROM submissions
WHERE user_id = p_user_id AND quest_id = p_quest_id
  AND status = 'approved'
  AND cooldown_until > NOW();
-- Se existir → retornar erro
```

---

#### 3. Transações Atômicas na Loja
**Problema:** A compra de itens na loja é feita em 2 steps separados no client-side (debita coins → insere purchase), deixando janela para inconsistência.

**Solução sugerida:**
```sql
CREATE OR REPLACE FUNCTION public.buy_shop_item(
  p_user_id UUID, p_item_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item RECORD;
  v_user RECORD;
BEGIN
  SELECT * INTO v_item FROM shop_items WHERE id = p_item_id AND is_active = TRUE FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado'); END IF;

  SELECT coins, tokens INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;

  -- Verifica saldo
  IF v_item.currency IN ('coins','both') AND v_user.coins < v_item.price_coins THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Saldo insuficiente');
  END IF;

  -- Verifica estoque
  IF v_item.stock > 0 THEN
    UPDATE shop_items SET stock = stock - 1 WHERE id = p_item_id;
  END IF;

  -- Debita
  UPDATE users SET
    coins  = coins  - COALESCE(v_item.price_coins, 0),
    tokens = tokens - COALESCE(v_item.price_tokens, 0)
  WHERE id = p_user_id;

  -- Registra compra
  INSERT INTO shop_purchases (user_id, item_id, qty, paid_coins, paid_tokens)
  VALUES (p_user_id, p_item_id, 1, v_item.price_coins, v_item.price_tokens);

  RETURN jsonb_build_object('ok', true, 'item_name', v_item.name);
END; $$;
```

---

### 🟡 Média Prioridade

#### 4. Sistema de Moderação Comunitária
**Problema:** Votos de moderação existem na tabela `content_votes` mas não têm efeito automático.

**Sugestão:** Trigger ou função que, ao atingir N votos `flag`, notifica admin automaticamente e opcionalmente oculta o conteúdo.

---

#### 5. Leaderboard Semanal com Premiação Automática
**Sugestão:** Ao executar `auto_reset_weekly_ranking`, distribuir recompensas automáticas para o top 3:
- 🥇 1º lugar: 500 coins + 1 token especial
- 🥈 2º lugar: 300 coins
- 🥉 3º lugar: 150 coins

---

#### 6. Perfil com Inventário Público
**Sugestão:** Permitir que usuários exibam itens comprados na loja no perfil público.
```sql
ALTER TABLE shop_purchases ADD COLUMN is_displayed BOOLEAN DEFAULT FALSE;
```

---

#### 7. Sistema de Eventos Temporários
**Sugestão:** Tabela dedicada para eventos com início/fim automático:
```sql
CREATE TABLE public.events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  icon_url    TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  bonus_xp_pct INT DEFAULT 0,   -- % extra de XP durante o evento
  bonus_coins_pct INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

#### 8. Histórico de Nível (Level History)
**Sugestão:** Registrar cada level-up para mostrar "Conquistou nível X em DD/MM":
```sql
CREATE TABLE public.level_history (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  level      INT NOT NULL,
  reached_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 🟢 Baixa Prioridade / Qualidade de Vida

#### 9. Aliases de Políticas RLS Consistentes
Todas as políticas v13 usam prefixo `v13_` para fácil identificação. Em versões futuras, usar `app_` como prefixo permanente.

#### 10. pg_cron para Auto-Reset Garantido
```sql
-- Requer plano Pro do Supabase ou pg_cron habilitado
SELECT cron.schedule('daily-reset',  '0 3 * * *', 'SELECT auto_reset_daily_ranking()');
SELECT cron.schedule('weekly-reset', '0 4 * * 1', 'SELECT auto_reset_weekly_ranking()');
SELECT cron.schedule('monthly-reset','0 5 1 * *', 'SELECT auto_reset_monthly_ranking()');
```

#### 11. Auditoria de Ações Admin
```sql
CREATE TABLE public.admin_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   UUID NOT NULL REFERENCES public.users(id),
  action     TEXT NOT NULL,   -- 'approve_submission', 'reject_map', etc.
  target_id  TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 12. Rate Limiting de Submissões
Adicionar coluna `daily_submissions` em `users` com reset diário para limitar spam de quests sem cooldown.

---

## 🐛 Bugs Conhecidos / Atenção

| # | Descrição | Impacto | Status |
|---|---|---|---|
| B1 | Cooldown verificado apenas no front-end | Médio — usuário avançado pode burlar | Aberto |
| B2 | Compra de item: 2 steps sem transação | Médio — pode desincronizar saldo | Aberto |
| B3 | `is_admin()` faz SELECT a cada policy check | Baixo — cache do Supabase mitiga | Monitorar |
| B4 | `getAdminAnalytics()` faz múltiplas queries separadas | Baixo — pode ser unificado em RPC | Futuro |
| B5 | `profile_nickname` pode divergir de `nickname` | Baixo — sem validação de consistência | Aceito |

---

## 📊 Estatísticas do Projeto v13

| Arquivo | Linhas | Descrição |
|---|---|---|
| `supabase/setup.sql` | ~340 | Schema base v5 |
| `supabase/migrations/v10_auto_ranking_reset.sql` | 219 | Auto-reset rankings |
| `supabase/migrations/v11_new_features.sql` | 219 | Amizades, HoF, Missões |
| `supabase/migrations/v12_group_missions_v2.sql` | 273 | Missões v2 refatoradas |
| `supabase/migrations/v13_full_rebuild.sql` | ~470 | **DROP+recria tudo melhorado** |
| `supabase/database.js` | 1536 | Cliente JS com todas as funções |
| `js/home.js` | 1779 | UI principal do jogador |
| `js/admin.js` | 1278 | Painel de administração |
| `home.html` | 644 | Página principal |
| `admin.html` | 560 | Painel admin |
| `css/style.css` | 944 | Estilos globais |
| `profile.html` | 335 | Perfil público |
| `change-password.html` | 242 | Reset de senha |
| `tests/test_suite.js` | ~500 | **Suite de testes** (novo) |
| **Total** | **~9400** | |

---

## 🚀 Como Executar o Rebuild v13

```bash
# 1. Abra o Supabase Dashboard → SQL Editor → New Query
# 2. Cole o conteúdo de supabase/migrations/v13_full_rebuild.sql
# 3. Clique em Run
# 4. Verifique o output: "=== BUILD CONCLUÍDO COM SUCESSO ==="

# Para testes automatizados:
cp .env.example .env   # preencha com suas credenciais de TESTE
npm install
npm test
```

### Verificação pós-rebuild:
```sql
-- Checar tabelas criadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- Checar funções
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' ORDER BY routine_name;

-- Dados iniciais
SELECT COUNT(*) FROM quests;        -- deve ser 8
SELECT COUNT(*) FROM achievements;  -- deve ser 11
SELECT COUNT(*) FROM shop_items;    -- deve ser 3
```
