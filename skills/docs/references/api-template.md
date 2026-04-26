# Template — Documentação de API/Backend

Use este template como base. Preencha todas as seções com informações reais do código analisado. Remova seções que não se aplicam.

---

```markdown
# [Nome do Projeto] — API

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-4+-000000?logo=express&logoColor=white)
<!-- Adicione/remova badges conforme a stack detectada -->

> Breve descrição do que esta API faz e qual problema ela resolve.

---

## Índice

- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Banco de Dados](#banco-de-dados)
- [Rotas da API](#rotas-da-api)
- [Autenticação](#autenticação)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Scripts](#scripts)
- [Estrutura de Pastas](#estrutura-de-pastas)
- [Deploy](#deploy)

---

## Pré-requisitos

- Node.js >= [versão detectada no package.json ou .nvmrc]
- npm ou yarn
- PostgreSQL [ou banco detectado] rodando localmente ou via URL remota

---

## Instalação

```bash
git clone [url-do-repositorio]
cd [nome-do-projeto]
npm install
```

---

## Configuração

Copie o arquivo de exemplo e preencha as variáveis:

```bash
cp .env.example .env
```

Consulte a seção [Variáveis de Ambiente](#variáveis-de-ambiente) para detalhes de cada variável.

---

## Banco de Dados

**ORM**: [Prisma / TypeORM / Sequelize — detectado]  
**Banco**: [PostgreSQL / MySQL / SQLite — detectado]

### Rodando as migrations

```bash
npx prisma migrate dev     # desenvolvimento
npx prisma migrate deploy  # produção
```

### Visualizando o banco

```bash
npx prisma studio
```

### Schema resumido

| Tabela/Model | Descrição |
|---|---|
| `[Model1]` | [O que representa] |
| `[Model2]` | [O que representa] |
<!-- Preencher com os models do schema.prisma -->

---

## Rotas da API

Base URL: `http://localhost:[PORT]/api`

### [Módulo 1 — ex: Autenticação]

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| `POST` | `/auth/login` | Autentica usuário e retorna token | 🔓 Pública |
| `POST` | `/auth/register` | Cria novo usuário | 🔓 Pública |
| `POST` | `/auth/refresh` | Renova token de acesso | 🔒 Token |

### [Módulo 2 — ex: Fornecedores]

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| `GET` | `/suppliers` | Lista todos os fornecedores | 🔒 Token |
| `GET` | `/suppliers/:id` | Retorna fornecedor por ID | 🔒 Token |
| `POST` | `/suppliers` | Cria novo fornecedor | 🔒 Token |
| `PUT` | `/suppliers/:id` | Atualiza fornecedor | 🔒 Token |
| `DELETE` | `/suppliers/:id` | Remove fornecedor | 🔒 Admin |

<!-- Repetir para cada módulo/recurso da API -->

---

## Autenticação

Esta API utiliza **JWT (JSON Web Token)**.

Para acessar rotas protegidas, inclua o token no header:

```http
Authorization: Bearer <seu-token>
```

O token é obtido na rota `POST /auth/login` e tem validade de [duração detectada no código].

---

## Variáveis de Ambiente

| Variável | Descrição | Exemplo | Obrigatória |
|---|---|---|---|
| `DATABASE_URL` | URL de conexão com o banco de dados | `postgresql://user:pass@localhost:5432/db` | ✅ Sim |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT | `minha-chave-super-secreta` | ✅ Sim |
| `PORT` | Porta em que o servidor vai rodar | `3000` | ❌ Não (padrão: 3000) |
| `NODE_ENV` | Ambiente de execução | `development` / `production` | ❌ Não |
<!-- Adicionar/remover conforme variáveis detectadas no código -->

---

## Scripts

```bash
npm run dev       # Inicia servidor em modo desenvolvimento (hot reload)
npm run build     # Compila TypeScript para JavaScript
npm start         # Inicia servidor em produção (após build)
npm test          # Executa os testes
npm run lint      # Verifica erros de lint
```

---

## Estrutura de Pastas

```
src/
├── controllers/    # Lógica de cada rota (recebe req, chama service, retorna res)
├── services/       # Regras de negócio e interação com o banco
├── routes/         # Definição das rotas Express
├── middlewares/    # Autenticação, validação, error handling
├── prisma/         # Schema do banco e migrations
│   └── schema.prisma
├── utils/          # Funções utilitárias reutilizáveis
└── app.ts          # Ponto de entrada da aplicação
```

<!-- Adaptar conforme estrutura real detectada no código -->

---

## Deploy

### Vercel

```bash
npm run build
vercel deploy
```

Certifique-se de configurar as variáveis de ambiente no painel da Vercel.

### Railway / Render

1. Conecte o repositório
2. Configure as variáveis de ambiente
3. Defina o comando de start: `npm start`
4. Rode as migrations antes do primeiro deploy: `npx prisma migrate deploy`

<!-- Ajustar conforme plataforma de deploy detectada ou mencionada pelo usuário -->
```