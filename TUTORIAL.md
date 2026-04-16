# 📚 TUTORIAL COMPLETO — Configurar RPG Quests v4 com Supabase

> **Tempo estimado:** 30–45 minutos  
> **Nível:** Iniciante  
> **O que você vai configurar:** Supabase (banco de dados + auth) + GitHub Pages (hospedagem)

## 🆕 Changelog v4 (último update)

| Item | Descrição |
|------|-----------|
| ✅ Link de confirmação de e-mail | Redireciona corretamente para `https://kayhamcristoffer.github.io/marmota-rpg-2.io/index.html` |
| ✅ Auto-criação de perfil | Login de usuários sem row na tabela `users` cria o perfil automaticamente |
| ✅ Emoji picker | Perfil: escolha de avatar por emoji (🐾⚔️👑…) sem precisar de URL de imagem |
| ✅ Prova de quest por URL | Comprovantes por link (prnt.sc, imgur) — upload de imagem apenas se `image_required=true` |
| ✅ Cooldown visual | Cards de quests mostram tempo restante antes do reset (01:45) |
| ✅ Timestamps em Minhas Quests | Data de envio e data de revisão exibidas por quest |
| ✅ Submissão de mapas pelos usuários | Aba "Enviar Mapa" no dashboard; admin aprova e define recompensas |
| ✅ Aba "Mapas Enviados" no admin | Admin revisa submissões pendentes de mapas com definição de recompensas |
| ✅ setUserRole persistindo | Correção do update de role/profile_role pelo admin |
| ✅ image_required no admin | Checkbox diferencia "Upload de imagem" vs "Aceita link de print" |
| ✅ map_submissions.image_url | Campo agora é URL (não mais base64) |

---

## 📋 Índice

1. [Criar projeto no Supabase](#1-criar-projeto-no-supabase)
2. [Executar o SQL de configuração](#2-executar-o-sql-de-configuração)
3. [Configurar autenticação](#3-configurar-autenticação)
4. [Ativar Realtime nas tabelas](#4-ativar-realtime-nas-tabelas)
5. [Pegar suas credenciais API](#5-pegar-suas-credenciais-api)
6. [Vincular ao projeto (editar supabase-config.js)](#6-vincular-ao-projeto)
7. [Ativar GitHub Pages](#7-ativar-github-pages)
8. [Tornar-se Admin](#8-tornar-se-admin)
9. [Configurar RLS (Segurança)](#9-configurar-rls)
10. [Migração do Firebase (opcional)](#10-migração-do-firebase)
11. [Checklist Final](#11-checklist-final)
12. [Resolução de Problemas](#12-resolução-de-problemas)

---

## 1. Criar Projeto no Supabase

### 1.1 — Criar conta
1. Acesse: **https://supabase.com**
2. Clique em **"Start your project"**
3. Faça login com GitHub (recomendado) ou e-mail

### 1.2 — Novo projeto
1. Clique em **"New project"**
2. Preencha:
   - **Name:** `marmota-rpg` (ou qualquer nome)
   - **Database Password:** Crie uma senha forte e **anote ela!**
   - **Region:** `South America (São Paulo)` ← mais rápido para usuários BR
3. Clique **"Create new project"**
4. ⏳ Aguarde ~2 minutos para o projeto inicializar

---

## 2. Executar o SQL de Configuração

### 2.1 — Abrir o SQL Editor
1. No painel do Supabase, clique em **"SQL Editor"** (ícone de banco na barra lateral)
2. Clique em **"New query"**

### 2.2 — Executar o script
1. Abra o arquivo `supabase/setup.sql` do projeto
2. Copie **todo o conteúdo**
3. Cole no editor SQL do Supabase
4. Clique em **"Run"** (▶ botão verde)
5. Você deve ver: `Success. No rows returned`

### 2.3 — Verificar as tabelas criadas
Execute esta query para confirmar:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

Você deve ver estas tabelas:
- ✅ `users`
- ✅ `quests`
- ✅ `maps`
- ✅ `submissions`
- ✅ `achievements`
- ✅ `user_badges`
- ✅ `ranking_history`

---

## 3. Configurar Autenticação

### 3.1 — Email Auth (já vem ativo)
1. Vá em **Authentication > Providers**
2. Confirme que **"Email"** está habilitado
3. ⚠️ **Importante:** Desative "Confirm email" para testes locais:
   - Vá em **Authentication > Settings**
   - Desative **"Enable email confirmations"**
   - (Reative quando lançar para produção)

### 3.2 — Configurar URL de redirecionamento
1. Vá em **Authentication > URL Configuration**
2. Em **"Site URL"**, coloque a URL do seu GitHub Pages:
   ```
   https://SEUUSUARIO.github.io/marmota-rpg-2.io
   ```
3. Em **"Redirect URLs"**, adicione:
   ```
   https://SEUUSUARIO.github.io/marmota-rpg-2.io/index.html
   https://SEUUSUARIO.github.io/marmota-rpg-2.io/home.html
   ```
4. Para desenvolvimento local, adicione também:
   ```
   http://localhost:8080
   http://localhost:3000
   ```
5. Clique **"Save"**

---

## 4. Ativar Realtime nas Tabelas

O Realtime permite que o ranking atualize automaticamente na tela sem reload.

1. Vá em **Database > Replication**
2. Na seção **"Supabase Realtime"**, habilite para:
   - ✅ `users` (para o ranking atualizar em tempo real)
   - ✅ `submissions` (para admin ver submissões ao vivo)
3. Clique **"Save"**

---

## 5. Pegar suas Credenciais API

### 5.1 — Acessar as chaves
1. Vá em **Project Settings** (ícone de engrenagem)
2. Clique em **"API"**

### 5.2 — Copiar os valores
Você precisará de **3 valores**:

| Campo | Onde encontrar | Exemplo |
|-------|---------------|---------|
| **Project URL** | "Project URL" na seção API | `https://abcxyz123.supabase.co` |
| **Anon/Public Key** | "Project API keys > anon public" | `eyJhbGciOiJIUzI1...` |
| **Seu User ID** | Authentication > Users (após criar conta) | `a1b2c3d4-...` |

> ⚠️ **NUNCA compartilhe a `service_role` key!** Use apenas a `anon` key no frontend.

---

## 6. Vincular ao Projeto

### 6.1 — Editar o arquivo de configuração
Abra o arquivo `supabase/supabase-config.js` no projeto e substitua os valores:

```javascript
// ANTES (placeholders):
export const SUPABASE_URL = 'https://SEU_PROJETO.supabase.co';
export const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_PUBLICA';
export const ADMIN_UID = 'SEU_USER_ID_AQUI';

// DEPOIS (seus valores reais):
export const SUPABASE_URL = 'https://abcxyz123.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
export const ADMIN_UID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
```

> 💡 **Dica:** Você pode obter seu User ID depois de criar a primeira conta no sistema. Veja o passo 8.

### 6.2 — Fazer o commit das mudanças
```bash
git add supabase/supabase-config.js
git commit -m "config: add Supabase credentials"
git push origin main
```

---

## 7. Ativar GitHub Pages

### 7.1 — Configurar Pages
1. Vá no repositório: `https://github.com/KayhamCristoffer/marmota-rpg-2.io`
2. Clique em **Settings** (aba do repositório)
3. No menu lateral, clique em **"Pages"**
4. Em **"Source"**, selecione:
   - **Branch:** `main`
   - **Folder:** `/ (root)`
5. Clique **"Save"**
6. ⏳ Aguarde 1–2 minutos e o site estará em:
   ```
   https://KayhamCristoffer.github.io/marmota-rpg-2.io/
   ```

---

## 8. Tornar-se Admin

### 8.1 — Criar sua primeira conta
1. Acesse o site publicado
2. Crie uma conta com seu e-mail
3. Acesse o sistema

### 8.2 — Pegar seu User ID
1. No Supabase, vá em **Authentication > Users**
2. Encontre sua conta e copie o **UUID** (ex: `a1b2c3d4-...`)
3. Cole esse UUID no `supabase/supabase-config.js` como `ADMIN_UID`
4. Faça commit e push

### 8.3 — Tornar-se admin via SQL
Execute no **SQL Editor** do Supabase:
```sql
UPDATE users 
SET role = 'admin' 
WHERE email = 'seu@email.com';
```

Ou via painel:
1. Vá em **Database > Table Editor > users**
2. Encontre seu usuário
3. Edite o campo `role` para `admin`

---

## 9. Configurar RLS (Row Level Security)

As políticas de segurança já foram criadas pelo `setup.sql`. Mas veja o que elas fazem:

| Tabela | Regra |
|--------|-------|
| `users` | Qualquer um lê; usuário edita só o próprio perfil |
| `quests` | Todos veem quests ativas; apenas admin cria/edita |
| `maps` | Todos veem; apenas admin cria/edita |
| `submissions` | Usuário vê as próprias; admin vê todas |
| `achievements` | Todos leem; apenas admin gerencia |
| `user_badges` | Usuário vê as próprias; admin concede |

### Verificar se RLS está funcionando:
1. Vá em **Database > Tables**
2. Clique em cada tabela e confirme que **"RLS enabled"** aparece

---

## 10. Migração do Firebase (opcional)

Se você tem dados no Firebase e quer migrar:

### 10.1 — Exportar usuários do Firebase
1. No Firebase Console, vá em **Database > Export**
2. Baixe o arquivo JSON

### 10.2 — Converter para CSV
Use este código Python para converter usuários:
```python
import json
import csv

with open('marmota-rpg-export.json') as f:
    data = json.load(f)

users = data.get('users', {})
with open('users.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['nickname','email','role','level','xp','coins','tokens'])
    writer.writeheader()
    for uid, u in users.items():
        writer.writerow({
            'nickname': u.get('nickname', u.get('name', 'user')),
            'email':    u.get('email', ''),
            'role':     u.get('role', 'user'),
            'level':    u.get('level', 1),
            'xp':       u.get('xp', 0),
            'coins':    u.get('coins', 0),
            'tokens':   u.get('tokens', 0)
        })
print('CSV gerado!')
```

### 10.3 — Importar no Supabase
1. Vá em **Database > Table Editor > users**
2. Clique em **"Import data"**
3. Selecione o arquivo CSV
4. Mapeie as colunas
5. Clique **"Import"**

> ⚠️ **Atenção:** Os usuários precisam criar nova conta no Supabase Auth. O CSV importa apenas os dados do perfil, não as senhas (por segurança).

---

## 11. Checklist Final

Antes de divulgar o link, verifique:

- [ ] **Supabase configurado:** Projeto criado, SQL executado
- [ ] **Tabelas criadas:** 7 tabelas + índices + funções
- [ ] **Auth configurado:** URL do site adicionada nas redirect URLs
- [ ] **Realtime ativo:** Tabela `users` com replicação habilitada
- [ ] **Credenciais vinculadas:** `supabase-config.js` atualizado com suas keys
- [ ] **GitHub Pages ativo:** Site acessível pela URL do GitHub
- [ ] **Admin configurado:** Seu usuário com `role = 'admin'`
- [ ] **Teste de login:** Conseguiu criar conta e entrar
- [ ] **Teste de quest:** Admin criou quest, usuário enviou comprovante
- [ ] **Teste de ranking:** Ranking exibe após aprovação de quest

---

## 12. Resolução de Problemas

### ❌ "Invalid API key" ou "JWT expired"
→ Verifique se `SUPABASE_ANON_KEY` está correto em `supabase-config.js`

### ❌ "new row violates row-level security policy"
→ Certifique-se que seu usuário existe na tabela `users` após criar conta.  
Execute no SQL Editor:
```sql
SELECT * FROM users WHERE email = 'seu@email.com';
```
Se não aparecer, insira manualmente:
```sql
INSERT INTO users (id, email, nickname, role) 
VALUES (auth.uid(), 'seu@email.com', 'SeuNick', 'admin');
```

### ❌ "relation users does not exist"
→ Execute novamente o script `supabase/setup.sql`

### ❌ Ranking não atualiza em tempo real
→ Verifique se a tabela `users` está com **Replication** habilitada em **Database > Replication**

### ❌ "Email not confirmed" ao fazer login
→ Vá em **Authentication > Settings** e desative "Enable email confirmations" (para dev)

### ❌ Imagem do comprovante não aparece
→ O sistema usa base64 (armazenado direto no banco). Se o comprovante for muito grande (>2MB), será rejeitado pelo sistema.

### ❌ Admin não tem acesso ao painel
→ Confirme que `role = 'admin'` na tabela `users` E que seu UUID está em `ADMIN_UID` no `supabase-config.js`

---

## 🎯 Estrutura do Projeto

```
marmota-rpg-2.io/
├── index.html              ← Página de login
├── home.html               ← Dashboard do usuário
├── admin.html              ← Painel administrativo
├── css/
│   └── style.css           ← Estilos globais
├── js/
│   ├── auth.js             ← Login/Registro
│   ├── home.js             ← Dashboard + Quests + Ranking
│   └── admin.js            ← Painel Admin completo
└── supabase/
    ├── supabase-config.js  ← ⚠️ SUAS CREDENCIAIS AQUI
    ├── client.js           ← Inicialização do cliente
    ├── database.js         ← Todas as funções de DB
    ├── session-manager.js  ← Gestão de sessão e UI
    └── setup.sql           ← Script SQL completo
```

---

## 🔗 Links Úteis

| Recurso | URL |
|---------|-----|
| Supabase Dashboard | https://supabase.com/dashboard |
| Supabase Docs | https://supabase.com/docs |
| Supabase JS Client | https://supabase.com/docs/reference/javascript |
| GitHub Pages Docs | https://pages.github.com |
| Seu projeto (live) | https://KayhamCristoffer.github.io/marmota-rpg-2.io/ |

---

## 13. Correções v2 — Erros de Produção

Esta seção documenta todos os erros corrigidos na atualização v2.

---

### 🐛 FK Violation: `submissions_user_id_fkey`

**Erro:** `insert or update on table "submissions" violates foreign key constraint "submissions_user_id_fkey"`

**Causa:** O usuário está autenticado no Auth mas ainda não tem registro na tabela `users`.

**Correção aplicada:**
1. Trigger `handle_new_user()` criado — cria o perfil automaticamente ao registrar no Auth.
2. A função `createSubmission()` agora verifica se o perfil existe antes de inserir.
3. A função `signIn()` garante criação do perfil se o trigger falhou.

**Se o erro persistir**, execute no SQL Editor:
```sql
-- Cria perfil para usuário que já está no Auth mas não na tabela users
INSERT INTO users (id, email, nickname, profile_nickname, role, profile_role, level, xp, coins, tokens)
SELECT 
  au.id,
  au.email,
  split_part(au.email, '@', 1) AS nickname,
  split_part(au.email, '@', 1) AS profile_nickname,
  'user',
  'Marmotinha',
  1, 0, 0, 0
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL;
```

---

### 🐛 RLS: `new row violates row-level security policy`

**Tabelas afetadas:** `quests`, `maps`, `achievements`, `user_badges`

**Causa:** A policy antiga usava `FOR ALL` mas o INSERT precisava de uma policy separada.

**Correção aplicada:**
- Policies separadas para SELECT, INSERT, UPDATE e DELETE.
- Função helper `is_admin()` criada com `SECURITY DEFINER` para evitar recursão.
- Execute o `setup.sql` v2 para aplicar as políticas corrigidas.

**Para verificar as policies ativas:**
```sql
SELECT tablename, policyname, cmd, qual 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
```

---

### 🐛 Profile Edit: `Cannot coerce the result to a single JSON object`

**Causa:** `updateUserProfile()` usava `.select().single()` — quando a atualização afeta 0 linhas o Supabase lança esse erro.

**Correção aplicada:** Removido `.single()`, retorna `data?.[0] ?? null` em vez disso.

---

### 🐛 Lista de usuários vazia no Admin

**Causa:** A RLS policy de `users` só permitia ver o próprio perfil. Admins precisam ver todos.

**Correção aplicada:** Policy `users_select` agora permite qualquer usuário autenticado ler todos os registros. A função `is_admin()` permite updates em qualquer usuário.

---

### 🐛 Email rate limit exceeded / E-mail inválido

**Causa:** Supabase tem limite de e-mails por hora no plano gratuito (padrão 3/hora em dev).

**Solução:**
1. Vá em **Authentication > Settings**
2. Desative **"Enable email confirmations"** (para desenvolvimento)
3. Em produção: configure um servidor SMTP próprio em **Authentication > Settings > SMTP Settings**:
   - Use SendGrid, Resend, Mailgun ou similar
   - Aumenta o limite para centenas de e-mails/hora
4. **Para criar usuários de teste sem e-mail:**
   ```sql
   -- Cria usuário diretamente via SQL (sem e-mail de confirmação)
   -- Use Authentication > Users > "Add user" no painel Supabase
   ```
   Ou via painel: **Authentication > Users > "+ Add user"** → preencha e-mail e senha.

---

### 🐛 Criação automática de usuário no cadastro

**Como funciona no v2:**
- O trigger `on_auth_user_created` cria automaticamente o registro em `public.users` quando alguém se registra.
- O nickname base é derivado do e-mail (parte antes do @).
- Colisões de nickname são resolvidas adicionando um número.
- O usuário pode depois editar seu **Nome de Exibição** (`profile_nickname`) no perfil.

**Para verificar se o trigger está ativo:**
```sql
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';
```

---

### 🐛 Prefixo "Nv" removido

**Correção:** O nível agora exibe apenas o número (ex: `15` em vez de `Nv 15`).  
- Sidebar: badge de nível mostra só o número  
- Perfil: campo de nível mostra só o número  
- Ranking: coluna de nível mostra só o número  

---

### ✨ Novas funcionalidades v2

#### Nome de Exibição (`profile_nickname`)
- Usuários podem editar seu **Nome de Exibição** no Perfil sem alterar o `nickname` único de sistema.
- O ranking usa `profile_nickname` (ou `nickname` como fallback).

#### Cargo Customizável (`profile_role`)
- Admins podem definir o cargo exibido de cada usuário (ex: "Marmotinha", "Builder", "VIP", "Fundador").
- Acesse: **Admin > Usuários > Editar**.

#### Toggle Moedas / Tokens no Ranking
- Na página de Ranking há dois botões para alternar entre ranking de **Moedas** e **Tokens**.

#### Seletor de Ícones para Mapas
- O modal de criação/edição de mapa tem seletor de tipo com ícone automático:
  - 🗺️ Aventura · ⚔️ PvP · 🏙️ Cidade · 🏰 Dungeon · 🍀 Lucky Block · 🎉 Evento · 🌿 Survival · 🏃 Parkour · ⭐ Customizado
- Campo de ícone customizado (emoji ou URL).
- Campo de URL de imagem do mapa (screenshot/capa).

---

## 14. Recriar Tabelas do Zero

Se precisar resetar tudo:

```sql
-- ⚠️ CUIDADO: apaga TODOS os dados!
DROP TABLE IF EXISTS user_badges      CASCADE;
DROP TABLE IF EXISTS ranking_history  CASCADE;
DROP TABLE IF EXISTS submissions      CASCADE;
DROP TABLE IF EXISTS achievements     CASCADE;
DROP TABLE IF EXISTS maps             CASCADE;
DROP TABLE IF EXISTS quests           CASCADE;
DROP TABLE IF EXISTS users            CASCADE;
DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();
DROP FUNCTION IF EXISTS is_admin();
DROP FUNCTION IF EXISTS increment_map_likes(UUID);
DROP FUNCTION IF EXISTS update_updated_at();

-- Em seguida, execute o supabase/setup.sql novamente
```

---

## 15. Inserir Dados de Teste

Após executar o `setup.sql`, para inserir usuários de teste via painel:

1. Vá em **Authentication > Users > "+ Add user"**
2. Preencha e-mail e senha (mínimo 6 caracteres)
3. O trigger criará o registro em `users` automaticamente

Para tornar o usuário admin:
```sql
UPDATE users 
SET role = 'admin', profile_role = 'Admin'
WHERE email = 'seu@email.com';
```

Para inserir um mapa de teste:
```sql
INSERT INTO maps (title, description, type, icon_url, reward_coins, reward_xp)
VALUES ('Dungeon do Dragão', 'Enfrente o dragão ancião neste mapa épico', 'dungeon', '🏰', 200, 150);
```

---

> 🛡️ **RPG Quests v2** — Migrado de Firebase para Supabase  
> Desenvolvido por KayhamCristoffer
