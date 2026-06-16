import { FastifyInstance } from 'fastify'
import * as savesController from './saves.controller.js'

export async function savesRoutes(app: FastifyInstance) {
  app.get('/saves', {
    schema: {
      tags: ['Saves'],
      summary: 'Listar todos os saves',
      description: 'Retorna todos os saves com o `currentClubStint` (clube atual).',
    },
  }, savesController.listSaves)

  app.get<{ Params: { saveId: string } }>('/saves/:saveId', {
    schema: {
      tags: ['Saves'],
      summary: 'Buscar save por ID',
      params: {
        type: 'object',
        properties: {
          saveId: { type: 'string', description: 'UUID do save' },
        },
      },
    },
  }, savesController.getSave)

  app.post<{ Body: { name: string; club: string; budget: number; europeanCompetitionId?: string | null } }>(
    '/saves',
    {
      schema: {
        tags: ['Saves'],
        summary: 'Criar novo save',
        description: 'Cria um save, um ClubStint inicial e TeamSeasonStats para cada competição do país do clube. O `balance` é inicializado igual ao `budget`.',
        body: {
          type: 'object',
          required: ['name', 'club', 'budget'],
          properties: {
            name: { type: 'string', minLength: 1, description: 'Nome do save' },
            club: { type: 'string', minLength: 1, description: 'Clube inicial (deve existir na lista de /api/clubs)' },
            budget: { type: 'number', minimum: 0, example: 100, description: 'Orçamento inicial em milhões de €: 100 = €100M' },
            europeanCompetitionId: { type: 'string', nullable: true, description: 'UUID da competição europeia (Champions, Europa, Conference) ou null' },
          },
        },
      },
    },
    savesController.createSave
  )

  app.patch<{
    Params: { saveId: string }
    Body: {
      currentYear?: number
      currentSeason?: string
      budget?: number
      balance?: number
      europeanCompetitionId?: string | null
    }
  }>(
    '/saves/:saveId',
    {
      schema: {
        tags: ['Saves'],
        summary: 'Atualizar save',
        description: 'Ao alterar `currentSeason`, cria automaticamente TeamSeasonStats (por competição), PlayerSeasonStats e troféus para a nova temporada. `europeanCompetitionId` define em qual europeia o clube participa (null = nenhuma).',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string', description: 'UUID do save' },
          },
        },
        body: {
          type: 'object',
          properties: {
            currentYear: { type: 'integer', example: 2027 },
            currentSeason: { type: 'string', example: '2027/28' },
            budget: { type: 'number', minimum: 0, example: 100, description: 'Em milhões de €' },
            balance: { type: 'number', minimum: 0, example: 12, description: 'Em milhões de €' },
            europeanCompetitionId: { type: 'string', nullable: true, description: 'UUID da competição europeia ou null para nenhuma' },
          },
        },
      },
    },
    savesController.updateSave
  )

  app.delete<{ Params: { saveId: string }; Querystring: { confirm?: string; purge?: string } }>(
    '/saves/:saveId',
    {
      schema: {
        tags: ['Saves'],
        summary: 'Deletar save (soft por padrão, reversível)',
        description:
          'Por padrão faz **soft-delete** (arquiva, reversível) e tira um snapshot `pre-delete`. Com `?purge=true` apaga definitivamente (cascade + snapshots). Exige `?confirm=<saveId>` para evitar exclusão acidental.',
        params: {
          type: 'object',
          properties: {
            saveId: { type: 'string', description: 'UUID do save' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            confirm: { type: 'string', description: 'Deve ser igual ao saveId para confirmar' },
            purge: { type: 'string', enum: ['true', 'false'], description: 'true = exclusão definitiva' },
          },
        },
      },
    },
    savesController.deleteSave
  )

  app.get('/saves/deleted', {
    schema: {
      tags: ['Saves'],
      summary: 'Listar saves arquivados (lixeira)',
      description: 'Retorna os saves soft-deleted do usuário, para recuperação.',
    },
  }, savesController.listDeletedSaves)

  app.post<{ Params: { saveId: string } }>('/saves/:saveId/restore', {
    schema: {
      tags: ['Saves'],
      summary: 'Restaurar save arquivado',
      description: 'Des-arquiva um save soft-deleted (limpa deletedAt). Para reverter um avanço de temporada, use o restore por snapshot.',
      params: {
        type: 'object',
        properties: { saveId: { type: 'string', description: 'UUID do save' } },
      },
    },
  }, savesController.restoreSave)

  app.get<{ Params: { saveId: string } }>('/saves/:saveId/audit', {
    schema: {
      tags: ['Saves'],
      summary: 'Histórico de auditoria do save',
      description: 'Mutações irreversíveis e recuperações (avanço de temporada, delete, reversão de transferência, liberação de jogador, troca de clube, import, edição de saldo...), mais recente primeiro.',
      params: {
        type: 'object',
        properties: { saveId: { type: 'string', description: 'UUID do save' } },
      },
    },
  }, savesController.listAuditLog)

  app.get<{ Params: { saveId: string } }>('/saves/:saveId/snapshots', {
    schema: {
      tags: ['Saves'],
      summary: 'Listar snapshots do save',
      description: 'Snapshots (pontos de restauração) tirados antes de operações irreversíveis ou manualmente.',
      params: {
        type: 'object',
        properties: { saveId: { type: 'string', description: 'UUID do save' } },
      },
    },
  }, savesController.listSnapshots)

  app.post<{ Params: { saveId: string } }>('/saves/:saveId/snapshots', {
    schema: {
      tags: ['Saves'],
      summary: 'Criar snapshot manual (save-point)',
      params: {
        type: 'object',
        properties: { saveId: { type: 'string', description: 'UUID do save' } },
      },
    },
  }, savesController.createSnapshot)

  app.post<{ Params: { saveId: string; snapshotId: string } }>('/saves/:saveId/snapshots/:snapshotId/restore', {
    schema: {
      tags: ['Saves'],
      summary: 'Restaurar o save a partir de um snapshot',
      description: 'Reverte o save inteiro ao estado do snapshot (apaga e recria as linhas filhas). Des-arquiva se estava soft-deleted.',
      params: {
        type: 'object',
        properties: {
          saveId: { type: 'string', description: 'UUID do save' },
          snapshotId: { type: 'string', description: 'UUID do snapshot' },
        },
      },
    },
  }, savesController.restoreSnapshot)
}
