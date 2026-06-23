import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getSaveDossierJson } from '../../features/saves/dossier.service.js'
import type { McpContext } from '../context.js'

const MIME = 'application/json'

export function registerDossierResource(server: McpServer, ctx: McpContext) {
  server.registerResource(
    'save-dossier',
    new ResourceTemplate('save://{saveId}/dossier', { list: undefined }),
    {
      title: 'Save dossier',
      description:
        'Dense JSON briefing for a save: club, season, finances, top 5 players, identified squad gaps, current season results. Attach at the start of a conversation.',
      mimeType: MIME,
    },
    async (uri, variables) => {
      const saveIdRaw = variables.saveId
      const saveId = Array.isArray(saveIdRaw) ? saveIdRaw[0] : saveIdRaw
      if (!saveId) throw new Error('saveId ausente no URI save://{saveId}/dossier.')

      const text = await getSaveDossierJson(ctx.userId, saveId)
      if (!text) throw new Error('Save não encontrado ou sem permissão.')

      return { contents: [{ uri: uri.href, mimeType: MIME, text }] }
    },
  )
}
