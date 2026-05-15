import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from '../context.js'
import { registerSavesTools } from './saves.js'
import { registerFinancesTools } from './finances.js'
import { registerScoutingTools } from './scouting.js'

export function registerTools(server: McpServer, ctx: McpContext) {
  registerSavesTools(server, ctx)
  registerFinancesTools(server, ctx)
  registerScoutingTools(server, ctx)
}
