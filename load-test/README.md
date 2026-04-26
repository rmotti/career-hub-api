# Load Test — Career Hub API

## Pré-requisitos

```bash
# Instalar k6 (Windows)
choco install k6
# ou baixar em: https://k6.io/docs/get-started/installation/
```

## Passo a passo

### 1. Suba a API localmente

```bash
npm run dev
```

### 2. Crie os usuários de teste (uma vez só)

```bash
npx tsx load-test/seed-users.ts

# Para outro ambiente:
npx tsx load-test/seed-users.ts --base-url https://staging.seu-app.com
```

### 3. Rode o teste

```bash
# Padrão: 10 VUs por 30s (stdout)
k6 run load-test/k6.js

# Com dashboard no Grafana (suba o docker-compose antes)
k6 run --out influxdb=http://localhost:8086/k6 load-test/k6.js

# Personalizado + Grafana
k6 run --out influxdb=http://localhost:8086/k6 -e VUS=50 -e DURATION=60s load-test/k6.js

# Contra staging
BASE_URL=https://staging.seu-app.com k6 run load-test/k6.js
```

### 4. Ver resultados no Grafana

1. Abra http://localhost:3000
2. O dashboard **k6 Load Testing Results** já estará disponível em Dashboards

### 5. Limpar usuários de teste (quando quiser)

```bash
npx tsx load-test/cleanup-users.ts
```

## O que o teste mede

| Métrica                  | Threshold  | Descrição                 |
|--------------------------|------------|---------------------------|
| `http_req_failed`        | < 5%       | Taxa geral de erro        |
| `http_req_duration`      | p95 < 2s   | Latência geral            |
| `login_duration`         | p95 < 3s   | Tempo de login            |
| `list_saves_duration`    | p95 < 1s   | Listagem de saves         |
| `create_save_duration`   | p95 < 1.5s | Criação de save           |
| `list_players_duration`  | p95 < 1.5s | Listagem de jogadores     |

## Fluxo simulado por usuário virtual

1. Login (Bearer token)
2. Listar saves
3. Listar clubes
4. Criar um save
5. Listar jogadores do save
6. Deletar o save (limpeza automática)
