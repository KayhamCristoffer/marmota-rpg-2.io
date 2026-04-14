# RPG Quests v2 ⚔️ — Powered by Supabase

> Sistema de quests gamificado estilo RPG, migrado do Firebase para **Supabase + PostgreSQL**

[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)](https://supabase.com)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=flat&logo=github)](https://pages.github.com)
[![Vanilla JS](https://img.shields.io/badge/Vanilla%20JS-F7DF1E?style=flat&logo=javascript&logoColor=black)](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript)

---

## ✨ Funcionalidades

### Autenticação
- Login com **email/senha** via Supabase Auth
- Sessão persistente com auto-logout em 30 minutos de inatividade
- Redefinição de senha via e-mail
- Criação automática de perfil ao registro

### Sistema de Quests
- Quests **Diárias**, **Semanais**, **Mensais** e **Eventos**
- Nível mínimo para desbloquear
- Envio de **comprovante (imagem)** para revisão do admin
- Status: Pendente → Em Análise → Aprovada / Rejeitada

### Sistema de Mapas
- Galeria de mapas com download
- Curtidas e visualizações
- Recompensas por submissão comprovada

### Estatísticas & Perfil
- XP e Sistema de Níveis
- Moedas totais, diárias, semanais e mensais
- Tokens
- Nickname e avatar personalizáveis

### Ranking
- Filtros: **Total | Diário | Semanal | Mensal**
- Pódio visual para Top 3
- **Atualização em tempo real** via Supabase Realtime
- Histórico de rankings salvo antes dos resets

### Painel Admin
- Criar, editar, ativar/desativar e deletar quests
- Criar e gerenciar mapas
- Aprovar ou rejeitar comprovantes
- Gerenciar roles de usuários
- Gerenciar conquistas (badges)
- Reset manual de rankings com histórico

---

## 🛠️ Tecnologias

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5, CSS3, JavaScript ES Modules (Vanilla) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (Email/Senha) |
| Realtime | Supabase Realtime |
| Hosting | GitHub Pages |
| Fonts | Cinzel (Google Fonts) |
| Icons | Font Awesome 6 |

---

## 📁 Estrutura

```
marmota-rpg-2.io/
├── index.html              # Login
├── home.html               # Dashboard do usuário
├── admin.html              # Painel Admin
├── TUTORIAL.md             # Tutorial completo de configuração
├── css/
│   └── style.css           # Estilos
├── js/
│   ├── auth.js             # Login/Registro
│   ├── home.js             # Dashboard + todas as páginas
│   └── admin.js            # Painel administrativo
└── supabase/
    ├── supabase-config.js  # ⚠️ Suas credenciais aqui
    ├── client.js           # Cliente Supabase
    ├── database.js         # Todas as funções DB
    ├── session-manager.js  # Gestão de sessão
    └── setup.sql           # Script SQL completo
```

---

## 🚀 Setup Rápido

### 1. Criar projeto no Supabase
→ https://supabase.com > New Project

### 2. Executar o SQL
1. Abra **SQL Editor** no painel do Supabase
2. Copie o conteúdo de `supabase/setup.sql`
3. Execute

### 3. Configurar credenciais
Edite `supabase/supabase-config.js`:
```javascript
export const SUPABASE_URL  = 'https://SEU_PROJETO.supabase.co';
export const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON';
export const ADMIN_UID     = 'SEU_USER_ID';
```

### 4. Publicar no GitHub Pages
Settings > Pages > Branch: main

### 5. Tornar-se Admin
```sql
UPDATE users SET role = 'admin' WHERE email = 'seu@email.com';
```

> 📖 **[Leia o TUTORIAL.md para o passo a passo completo](TUTORIAL.md)**

---

## 🔒 Segurança

- Row Level Security (RLS) habilitado em todas as tabelas
- Usuários só editam seus próprios dados
- Admin é verificado por role no banco de dados
- Chave `anon` usada no frontend (sem dados sensíveis expostos)
- Auto-logout por inatividade (30 min)

---

## 📊 Diferenças do Firebase para Supabase

| Firebase | Supabase |
|----------|----------|
| Realtime Database (JSON) | PostgreSQL (relacional) |
| Firebase Auth | Supabase Auth |
| `onValue` listeners | Supabase Realtime channels |
| Rules (.json) | Row Level Security (SQL) |
| Cloud Functions | PostgreSQL Functions |
| Firebase CLI | SQL Editor / API |

---

## 📄 Licença

MIT — use e modifique à vontade!

---

> ⚔️ Feito com ❤️ por KayhamCristoffer
