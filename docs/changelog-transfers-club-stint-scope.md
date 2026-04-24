# Breaking change: `GET /transfers?season=current` agora scoped por club stint

## Contexto

Ao trocar de clube durante uma temporada em andamento, as transferências registradas no stint anterior apareciam na listagem do novo clube porque o filtro `?season=current` usava apenas a temporada como critério.

---

## O que mudou

### `GET /api/saves/:saveId/transfers?season=current`

**Comportamento anterior:** retornava todas as transferências da temporada atual, independente do clube.

**Comportamento novo:** retorna apenas as transferências do clube atual (club stint ativo) na temporada atual.

> Transferências de stints anteriores na mesma temporada **não aparecem mais** neste endpoint com `?season=current`.

**Sem filtro de temporada (`GET /transfers` sem query params):** sem alteração — continua retornando todo o histórico de transferências do save.

---

### `POST /api/saves/:saveId/transfers` — resposta

O objeto de transferência criado agora inclui o campo `clubStintId`:

```json
{
  "transfer": {
    "id": "...",
    "saveId": "...",
    "clubStintId": "uuid-do-stint-atual",
    "playerName": "...",
    "type": "compra",
    "from": "...",
    "to": "...",
    "fee": null,
    "season": "2028/29",
    "createdAt": "..."
  }
}
```

`clubStintId` pode ser `null` em transferências criadas antes desta atualização.

---

## Invalidação de cache ao trocar de clube

Ao criar um novo club stint (`POST /api/saves/:saveId/club-stints`), os caches de **transfers**, **team-stats** e **players** são agora invalidados automaticamente. O frontend não precisa fazer nada diferente, mas pode esperar que a primeira requisição após a troca de clube seja um pouco mais lenta (cache miss).

---

## Ação necessária no frontend

| Situação | Ação |
|---|---|
| Listagem de transferências do clube atual | Nenhuma — o comportamento esperado agora funciona corretamente |
| Histórico completo de transferências do save | Usar `GET /transfers` sem `?season=current` |
| Exibição do campo `clubStintId` na UI | Opcional — campo disponível na resposta do POST |
