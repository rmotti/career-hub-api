import { FastifyReply, FastifyRequest } from 'fastify'
import {
  addShortlistItem,
  listShortlist,
  removeShortlistItem,
  updateShortlistItem,
  type ShortlistCreateInput,
  type ShortlistUpdateInput,
} from './shortlist.service.js'

interface SaveParams { saveId: string }
interface ItemParams { saveId: string; itemId: string }

export async function listShortlistHandler(
  request: FastifyRequest<{ Params: SaveParams }>,
  reply: FastifyReply
) {
  const items = await listShortlist(request.params.saveId, request.user!.id)
  return reply.send({ items })
}

export async function addShortlistHandler(
  request: FastifyRequest<{ Params: SaveParams; Body: ShortlistCreateInput }>,
  reply: FastifyReply
) {
  const item = await addShortlistItem(request.params.saveId, request.body, request.user!.id)
  return reply.status(201).send(item)
}

export async function updateShortlistHandler(
  request: FastifyRequest<{ Params: ItemParams; Body: ShortlistUpdateInput }>,
  reply: FastifyReply
) {
  const item = await updateShortlistItem(
    request.params.saveId,
    request.params.itemId,
    request.body,
    request.user!.id
  )
  return reply.send(item)
}

export async function deleteShortlistHandler(
  request: FastifyRequest<{ Params: ItemParams }>,
  reply: FastifyReply
) {
  await removeShortlistItem(request.params.saveId, request.params.itemId, request.user!.id)
  return reply.status(204).send()
}
