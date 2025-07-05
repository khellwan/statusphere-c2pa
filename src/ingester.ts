import pino from 'pino'
import { IdResolver } from '@atproto/identity'
import { Firehose } from '@atproto/sync'
import type { Database } from '#/db'
import * as Status from '#/lexicon/types/xyz/statusphere/status'
import * as Post from '#/lexicon/types/app/bsky/feed/post'

export function createIngester(db: Database, idResolver: IdResolver) {
  const logger = pino({ name: 'firehose ingestion' })
  return new Firehose({
    idResolver,
    handleEvent: async (evt) => {
      // Watch for write events
      if (evt.event === 'create' || evt.event === 'update') {
        const now = new Date()
        const record = evt.record

        // If the write is a valid status update
        if (
          evt.collection === 'xyz.statusphere.status' &&
          Status.isRecord(record) &&
          Status.validateRecord(record).success
        ) {
          // Store the status in our SQLite
          await db
            .insertInto('status')
            .values({
              uri: evt.uri.toString(),
              authorDid: evt.did,
              status: record.status,
              createdAt: record.createdAt,
              indexedAt: now.toISOString(),
            })
            .onConflict((oc) =>
              oc.column('uri').doUpdateSet({
                status: record.status,
                indexedAt: now.toISOString(),
              })
            )
            .execute()
        }
        
        // If the write is a valid post
        else if (
          evt.collection === 'app.bsky.feed.post' &&
          Post.isRecord(record) &&
          Post.validateRecord(record).success
        ) {
          // Store the post in our SQLite
          await db
            .insertInto('post')
            .values({
              uri: evt.uri.toString(),
              authorDid: evt.did,
              text: record.text,
              facets: record.facets ? JSON.stringify(record.facets) : undefined,
              langs: record.langs ? JSON.stringify(record.langs) : undefined,
              createdAt: record.createdAt,
              indexedAt: now.toISOString(),
            })
            .onConflict((oc) =>
              oc.column('uri').doUpdateSet({
                text: record.text,
                facets: record.facets ? JSON.stringify(record.facets) : undefined,
                langs: record.langs ? JSON.stringify(record.langs) : undefined,
                indexedAt: now.toISOString(),
              })
            )
            .execute()
        }
      } else if (evt.event === 'delete') {
        if (evt.collection === 'xyz.statusphere.status') {
          // Remove the status from our SQLite
          await db.deleteFrom('status').where('uri', '=', evt.uri.toString()).execute()
        } else if (evt.collection === 'app.bsky.feed.post') {
          // Remove the post from our SQLite
          await db.deleteFrom('post').where('uri', '=', evt.uri.toString()).execute()
        }
      }
    },
    onError: (err) => {
      logger.error({ err }, 'error on firehose ingestion')
    },
    filterCollections: ['xyz.statusphere.status', 'app.bsky.feed.post'],
    excludeIdentity: true,
    excludeAccount: true,
  })
}
