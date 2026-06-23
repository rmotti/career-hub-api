import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ShortlistPriority } from '@prisma/client'
import { z } from 'zod'
import {
  addShortlistItem,
  listShortlist,
  removeShortlistItem,
} from '../../features/shortlist/shortlist.service.js'
import { prisma } from '../../shared/lib/prisma.js'
import { AppError } from '../../shared/utils/errors.js'
import type { McpContext } from '../context.js'
import { resolveSaveId } from '../utils.js'
import { noSaveResult, scoredPlayerLine, textResult, type ScoredPlayerLike } from './helpers.js'

const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH'])

/** Resolves a dataset sofifaId to the internal Fc26Player.id the shortlist stores. */
async function resolveFc26Id(sofifaId: number): Promise<number | null> {
  const player = await prisma.fc26Player.findUnique({ where: { sofifaId }, select: { id: true } })
  return player?.id ?? null
}

export function registerShortlistTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    'get_shortlist',
    {
      description:
        'Returns the players the user has shortlisted for this save, each enriched with the current fitScore for the active club, plus their priority (LOW/MEDIUM/HIGH) and notes. Use when the user asks about their shortlist, wants to review saved targets, or to compare shortlisted players.',
      inputSchema: { saveId: z.string().optional() },
    },
    async ({ saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const items = await listShortlist(id, ctx.userId)
      if (items.length === 0) return textResult('The shortlist is empty for this save.')

      const lines = items.map((item) => {
        const tags = [
          item.priority ? `priority ${item.priority}` : null,
          item.notes ? `note: ${item.notes}` : null,
        ].filter(Boolean)
        const base = scoredPlayerLine(item.fc26Player as unknown as ScoredPlayerLike)
        return tags.length ? `${base} · ${tags.join(' · ')}` : base
      })

      return textResult([`Shortlist (${items.length}):`, '', ...lines].join('\n'))
    },
  )

  server.registerTool(
    'add_to_shortlist',
    {
      description:
        'WRITE ACTION. Adds a dataset player (by sofifaId, from recommend_signings / search_transfer_targets results) to the save shortlist, optionally with a priority and a note. Confirm the player with the user before calling. Idempotent-ish: re-adding an already-shortlisted player is reported, not duplicated.',
      inputSchema: {
        sofifaId: z.number().int().describe('Player sofifaId from the FC26 dataset.'),
        priority: PRIORITY.optional(),
        notes: z.string().max(500).optional(),
        saveId: z.string().optional(),
      },
    },
    async ({ sofifaId, priority, notes, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const fc26PlayerId = await resolveFc26Id(sofifaId)
      if (fc26PlayerId === null) return textResult(`No FC26 player found for sofifaId ${sofifaId}.`)

      try {
        await addShortlistItem(
          id,
          { fc26PlayerId, priority: (priority ?? null) as ShortlistPriority | null, notes: notes ?? null },
          ctx.userId,
        )
        return textResult(`Added sofifaId ${sofifaId} to the shortlist.`)
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 409) {
          return textResult(`That player is already on the shortlist.`)
        }
        throw err
      }
    },
  )

  server.registerTool(
    'remove_from_shortlist',
    {
      description:
        'WRITE ACTION. Removes a player (by sofifaId) from the save shortlist. Confirm with the user before calling.',
      inputSchema: {
        sofifaId: z.number().int().describe('Player sofifaId from the FC26 dataset.'),
        saveId: z.string().optional(),
      },
    },
    async ({ sofifaId, saveId }) => {
      const id = await resolveSaveId(ctx.userId, saveId, ctx.saveId)
      if (!id) return noSaveResult

      const fc26PlayerId = await resolveFc26Id(sofifaId)
      if (fc26PlayerId === null) return textResult(`No FC26 player found for sofifaId ${sofifaId}.`)

      const item = await prisma.shortlistItem.findUnique({
        where: { saveId_fc26PlayerId: { saveId: id, fc26PlayerId } },
        select: { id: true },
      })
      if (!item) return textResult(`That player is not on the shortlist.`)

      await removeShortlistItem(id, item.id, ctx.userId)
      return textResult(`Removed sofifaId ${sofifaId} from the shortlist.`)
    },
  )
}
