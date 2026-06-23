import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from '../context.js'
import { registerSavesTools } from './saves.js'
import { registerFinancesTools } from './finances.js'
import { registerScoutingTools } from './scouting.js'
import { registerScoutIntelTools } from './scout-intel.js'
import { registerShortlistTools } from './shortlist.js'
import { registerSavedSearchTools } from './saved-searches.js'
import { registerSquadTools } from './squad.js'
import { registerPerformanceTools } from './performance.js'
import { registerHistoryTools } from './history.js'

export function registerTools(server: McpServer, ctx: McpContext) {
  registerSavesTools(server, ctx)
  registerFinancesTools(server, ctx)
  registerScoutingTools(server, ctx)
  registerScoutIntelTools(server, ctx)
  registerShortlistTools(server, ctx)
  registerSavedSearchTools(server, ctx)
  registerSquadTools(server, ctx)
  registerPerformanceTools(server, ctx)
  registerHistoryTools(server, ctx)
}
