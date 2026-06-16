import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { prisma } from '../../shared/lib/prisma.js'
import { cacheGet, cacheSet } from '../../shared/utils/cache.js'
import { formatBalance, formatSalary, millions, thousands } from '../../shared/utils/currency.js'
import type {
  ScoutPlaybookPreferences,
  ScoutPlaybookWeights,
} from '../../features/scout-playbooks/scout-playbooks.types.js'
import type { McpContext } from '../context.js'

const TTL = 300

function renderWeights(weights: ScoutPlaybookWeights | null): string {
  if (!weights) return '_Sem pesos configurados._'
  const entries = Object.entries(weights).filter(([, v]) => typeof v === 'number')
  if (entries.length === 0) return '_Sem pesos configurados._'
  return entries.map(([k, v]) => `- **${k}**: ${v}`).join('\n')
}

function renderPreferences(prefs: ScoutPlaybookPreferences | null): string {
  if (!prefs) return '_Sem preferências configuradas._'
  const lines: string[] = []
  if (prefs.objective) lines.push(`- **Objetivo:** ${prefs.objective}`)
  if (prefs.idealAgeMin !== undefined || prefs.idealAgeMax !== undefined) {
    lines.push(`- **Faixa etária ideal:** ${prefs.idealAgeMin ?? '?'}–${prefs.idealAgeMax ?? '?'}`)
  }
  if (prefs.maxMarketValue !== undefined) {
    lines.push(`- **Valor de mercado máximo:** ${formatBalance(millions(prefs.maxMarketValue))}`)
  }
  if (prefs.maxWage !== undefined) {
    lines.push(`- **Salário máximo:** ${formatSalary(thousands(prefs.maxWage))}`)
  }
  return lines.length ? lines.join('\n') : '_Sem preferências configuradas._'
}

export function registerPlaybookResource(server: McpServer, ctx: McpContext) {
  server.registerResource(
    'playbook',
    new ResourceTemplate('playbook://{saveId}', { list: undefined }),
    {
      title: 'Scout playbook',
      description:
        'Returns the default scout playbook for a save (scoring weights and preferences used to evaluate players).',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const saveIdRaw = variables.saveId
      const saveId = Array.isArray(saveIdRaw) ? saveIdRaw[0] : saveIdRaw
      if (!saveId) throw new Error('saveId ausente no URI playbook://{saveId}.')

      const cacheKey = `mcp:resource:playbook:${ctx.userId}:${saveId}`
      const cached = await cacheGet<string>(cacheKey)
      if (cached) {
        return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: cached }] }
      }

      const save = await prisma.save.findFirst({
        where: { id: saveId, userId: ctx.userId },
        select: { id: true, name: true },
      })
      if (!save) throw new Error('Save não encontrado ou sem permissão.')

      const playbook = await prisma.scoutPlaybook.findFirst({
        where: { saveId: save.id, isDefault: true },
      })

      const text = playbook
        ? [
            `# Scout playbook — ${playbook.name}`,
            ``,
            `Save: **${save.name}**`,
            ``,
            `## Pesos de avaliação`,
            renderWeights(playbook.weights as ScoutPlaybookWeights | null),
            ``,
            `## Preferências`,
            renderPreferences(playbook.preferences as ScoutPlaybookPreferences | null),
          ].join('\n')
        : [
            `# Scout playbook — ${save.name}`,
            ``,
            '_Nenhum playbook configurado para este save. O scoring usa pesos padrão (overall 35, age 20, historicalFit 25, potential 20)._',
          ].join('\n')

      await cacheSet(cacheKey, text, TTL)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    },
  )
}
