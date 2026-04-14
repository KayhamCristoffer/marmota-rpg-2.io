# 📚 TUTORIAL COMPLETO — Configurar RPG Quests v2 com Supabase

> **Tempo estimado:** 30–45 minutos  
> **Nível:** Iniciante  
> **O que você vai configurar:** Supabase (banco de dados + auth) + GitHub Pages (hospedagem)

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

> 🛡️ **RPG Quests v2** — Migrado de Firebase para Supabase  
> Desenvolvido por KayhamCristoffer
