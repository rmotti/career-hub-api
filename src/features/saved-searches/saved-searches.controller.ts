import { FastifyReply, FastifyRequest } from 'fastify'
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  updateSavedSearch,
  type SavedSearchCreateInput,
  type SavedSearchUpdateInput,
} from './saved-searches.service.js'

interface SaveParams { saveId: string }
interface ItemParams { saveId: string; id: string }

export async function listHandler(
  request: FastifyRequest<{ Params: SaveParams }>,
  reply: FastifyReply
) {
  const items = await listSavedSearches(request.params.saveId, request.user!.id)
  return reply.send({ items })
}

export async function createHandler(
  request: FastifyRequest<{ Params: SaveParams; Body: SavedSearchCreateInput }>,
  reply: FastifyReply
) {
  const item = await createSavedSearch(request.params.saveId, request.body, request.user!.id)
  return reply.status(201).send(item)
}

export async function updateHandler(
  request: FastifyRequest<{ Params: ItemParams; Body: SavedSearchUpdateInput }>,
  reply: FastifyReply
) {
  const item = await updateSavedSearch(
    request.params.saveId,
    request.params.id,
    request.body,
    request.user!.id
  )
  return reply.send(item)
}

export async function deleteHandler(
  request: FastifyRequest<{ Params: ItemParams }>,
  reply: FastifyReply
) {
  await deleteSavedSearch(request.params.saveId, request.params.id, request.user!.id)
  return reply.status(204).send()
}
