import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from '../context.js'
import { registerSavesTools } from './saves.js'
import { registerFinancesTools } from './finances.js'

export function registerTools(server: McpServer, ctx: McpContext) {
  registerSavesTools(server, ctx)
  registerFinancesTools(server, ctx)
}
