---
name: git-flow
description: Automatiza commit e push seguindo boas práticas de git flow e conventional commits. Use quando o usuário pedir para commitar, fazer push, ou salvar as alterações. Triggers: "faz o commit", "commita e faz push", "salva as alterações", "envia pro git", "git flow", "cria uma branch de feature", "manda pro repositório".
---

# Git Flow — Commit & Push

Automatiza o fluxo de commit e push seguindo **Conventional Commits** e **Git Flow**.

## Antes de começar

1. Execute `git status` para ver arquivos modificados e não rastreados.
2. Execute `git diff` (staged e unstaged) para entender o conteúdo das mudanças.
3. Execute `git log --oneline -5` para seguir o estilo de mensagem já adotado no projeto.
4. Identifique a branch atual com `git branch --show-current`.

## Conventional Commits — formato

```
<type>(<scope opcional>): <descrição curta em imperativo>

<corpo opcional — o "por quê", não o "o quê">

<rodapé opcional — breaking changes, closes #issue>
```

### Tipos aceitos

| Tipo       | Quando usar                                                   |
|------------|---------------------------------------------------------------|
| `feat`     | Nova feature visível ao usuário                               |
| `fix`      | Correção de bug                                               |
| `chore`    | Manutenção, deps, scripts — sem impacto funcional             |
| `refactor` | Refatoração sem mudança de comportamento                      |
| `style`    | Formatação, lint, sem lógica alterada                         |
| `test`     | Testes adicionados ou corrigidos                              |
| `docs`     | Apenas documentação                                           |
| `perf`     | Melhoria de performance                                       |
| `ci`       | Mudanças em pipelines CI/CD                                   |
| `revert`   | Reverte commit anterior                                       |

### Regras da mensagem

- **Imperativo, minúsculo, sem ponto final** no título: `feat: add player stats chart`
- Título com **até 72 caracteres**.
- Scope identifica o módulo afetado: `feat(auth): ...`, `fix(transfer): ...`.
- Corpo explica o **porquê**, não o que — omitir se óbvio.
- `BREAKING CHANGE:` no rodapé quando há quebra de contrato.
- **Nunca** use `git add -A` ou `git add .` sem antes listar os arquivos — evitar commitar `.env`, segredos ou binários.

## Fluxo de execução

### 1. Inspecionar o estado

```bash
git status
git diff --staged
git diff
git log --oneline -5
git branch --show-current
```

### 2. Decidir o que incluir no commit

- Liste os arquivos modificados relevantes para o escopo.
- **Exclua**: arquivos `.env`, `*.local`, binários, arquivos gerados automaticamente que não devem ir para o repo.
- Se houver mudanças em múltiplos escopos não relacionados, proponha **commits separados**.

### 3. Gerar a mensagem de commit

- Derive o `type` e `scope` a partir do diff real.
- Escreva a mensagem sem inventar contexto — base-se no código.
- Mostre a mensagem ao usuário antes de executar.

### 4. Stagear e commitar

```bash
git add <arquivos específicos>
git commit -m "$(cat <<'EOF'
<mensagem gerada>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### 5. Push

- **Branch já existe no remoto**: `git push`
- **Branch nova**: `git push -u origin <branch>`
- **Nunca** use `--force` ou `--force-with-lease` sem confirmação explícita do usuário.
- Se o push for rejeitado por divergência, informe o usuário e proponha `git pull --rebase` antes de tentar novamente.

## Proteções obrigatórias

- **Nunca pular hooks** com `--no-verify` — investigar a falha e corrigi-la.
- **Nunca forçar push** sem aprovação explícita.
- Se existirem mudanças não relacionadas, propor commits atômicos separados.

## Saída esperada

Ao final, informe:
- Branch atual e remoto de destino.
- Hash curto do commit criado.
- URL do PR (se o terminal retornar o link após o push).
- Próximo passo sugerido (ex: abrir PR, criar tag de versão).
