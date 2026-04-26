---
name: docs-api
description: Gera ou atualiza o README.md do repositório de API/backend. Use esta skill quando o usuário pedir para documentar o projeto, gerar ou atualizar o README, ou colar código da API para ser documentado. Triggers: "documenta o projeto", "gera o README", "atualiza a documentação", ou quando o usuário colar código de rotas, controllers, services, middlewares ou schema Prisma.
---

# Docs — API

Gera ou atualiza o `README.md` na raiz do repositório de API a partir do código-fonte fornecido.

## Regras

- **Sem placeholders**: nunca use `[descreva aqui]`, `TODO` ou campos vazios. Se uma informação não estiver no código, infira pelo contexto ou omita a seção.
- **Informações reais**: rotas, métodos HTTP, models do banco, variáveis de ambiente, scripts — tudo extraído do código fornecido.
- **Idioma**: seguir o idioma predominante do projeto.
- **Badges**: incluir badges do shields.io conforme stack detectada (Node.js, TypeScript, Express, Prisma, PostgreSQL, etc.).

## Template

Leia `references/api-template.md` e preencha com as informações reais do projeto.

## Saída

- Nome do arquivo: `README.md`
- Salvar em `/mnt/user-data/outputs/`
- Apresentar via `present_files`