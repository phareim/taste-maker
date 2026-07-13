import { getReaderUser } from '~/server/utils/readerSession'

export default defineEventHandler(async (event) => {
  const user = await getReaderUser(event)
  return { user }
})
