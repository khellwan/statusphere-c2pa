import SqliteDb from 'better-sqlite3'
import {
  Kysely,
  Migrator,
  SqliteDialect,
  Migration,
  MigrationProvider,
} from 'kysely'

// Types

export type DatabaseSchema = {
  status: Status
  post: Post
  auth_session: AuthSession
  auth_state: AuthState
}

export type Status = {
  uri: string
  authorDid: string
  status: string
  createdAt: string
  indexedAt: string
}

export type Post = {
  uri: string
  authorDid: string
  text: string
  langs?: string
  embedType?: string
  embedData?: string
  facets?: string
  replyParent?: string
  replyRoot?: string
  createdAt: string
  indexedAt: string
}

export type AuthSession = {
  key: string
  session: AuthSessionJson
}

export type AuthState = {
  key: string
  state: AuthStateJson
}

type AuthStateJson = string

type AuthSessionJson = string

// Migrations

const migrations: Record<string, Migration> = {}

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('status')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('status', 'varchar', (col) => col.notNull())
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('auth_session')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('session', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('auth_state')
      .addColumn('key', 'varchar', (col) => col.primaryKey())
      .addColumn('state', 'varchar', (col) => col.notNull())
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('auth_state').execute()
    await db.schema.dropTable('auth_session').execute()
    await db.schema.dropTable('status').execute()
  },
}

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('authorDid', 'varchar', (col) => col.notNull())
      .addColumn('text', 'text', (col) => col.notNull())
      .addColumn('langs', 'varchar') // JSON array as string: ["pt", "en"]
      .addColumn('embedType', 'varchar') // "images", "external", "record", etc.
      .addColumn('embedData', 'text') // JSON data for embeds
      .addColumn('facets', 'text') // JSON array for mentions, hashtags, links
      .addColumn('replyParent', 'varchar') // URI of parent post if this is a reply
      .addColumn('replyRoot', 'varchar') // URI of root post if this is in a thread
      .addColumn('createdAt', 'varchar', (col) => col.notNull())
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    
    // Add indexes for better performance
    await db.schema
      .createIndex('post_author_idx')
      .on('post')
      .column('authorDid')
      .execute()
    
    await db.schema
      .createIndex('post_created_idx')
      .on('post')
      .column('createdAt')
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('post').execute()
  },
}

// APIs

export const createDb = (location: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: new SqliteDb(location),
    }),
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export type Database = Kysely<DatabaseSchema>

// Helper types for posts
export interface PostEmbed {
  $type: 'app.bsky.embed.images' | 'app.bsky.embed.external' | 'app.bsky.embed.record'
  images?: Array<{
    image: { ref: string; mimeType: string; size: number }
    alt: string
    aspectRatio?: { width: number; height: number }
  }>
  external?: {
    uri: string
    title: string
    description: string
    thumb?: { ref: string; mimeType: string; size: number }
  }
}

export interface PostFacet {
  index: { byteStart: number; byteEnd: number }
  features: Array<{
    $type: 'app.bsky.richtext.facet#mention' | 'app.bsky.richtext.facet#link' | 'app.bsky.richtext.facet#tag'
    did?: string // for mentions
    uri?: string // for links
    tag?: string // for hashtags
  }>
}

export interface CreatePostData {
  text: string
  langs?: string[]
  embed?: PostEmbed
  facets?: PostFacet[]
  reply?: {
    parent: string // URI
    root: string   // URI
  }
}