import assert from 'node:assert'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import { isValidHandle } from '@atproto/syntax'
import { TID } from '@atproto/common'
import { Agent } from '@atproto/api'
import express from 'express'
import { getIronSession } from 'iron-session'
import type { AppContext } from '#/index'
import { home } from '#/pages/home'
import { login } from '#/pages/login'
import { env } from '#/lib/env'
import { page } from '#/lib/view'
import * as Status from '#/lexicon/types/xyz/statusphere/status'
import * as Post from '#/lexicon/types/app/bsky/feed/post'
import * as Profile from '#/lexicon/types/app/bsky/actor/profile'

type Session = { did: string }

// Helper function for defining routes
const handler =
  (fn: express.Handler) =>
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    try {
      await fn(req, res, next)
    } catch (err) {
      next(err)
    }
  }

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  ctx: AppContext
) {
  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: env.COOKIE_SECRET,
  })
  if (!session.did) return null
  try {
    const oauthSession = await ctx.oauthClient.restore(session.did)
    return oauthSession ? new Agent(oauthSession) : null
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth restore failed')
    await session.destroy()
    return null
  }
}

export const createRouter = (ctx: AppContext) => {
  const router = express.Router()

  // Static assets
  router.use('/public', express.static(path.join(__dirname, 'pages', 'public')))

  // OAuth metadata
  router.get(
    '/client-metadata.json',
    handler((_req, res) => {
      return res.json(ctx.oauthClient.clientMetadata)
    })
  )

  // OAuth callback to complete session creation
  router.get(
    '/oauth/callback',
    handler(async (req, res) => {
      const params = new URLSearchParams(req.originalUrl.split('?')[1])
      try {
        const { session } = await ctx.oauthClient.callback(params)
        const clientSession = await getIronSession<Session>(req, res, {
          cookieName: 'sid',
          password: env.COOKIE_SECRET,
        })
        assert(!clientSession.did, 'session already exists')
        clientSession.did = session.did
        await clientSession.save()
      } catch (err) {
        ctx.logger.error({ err }, 'oauth callback failed')
        return res.redirect('/?error')
      }
      return res.redirect('/')
    })
  )

  // Login page
  router.get(
    '/login',
    handler(async (_req, res) => {
      return res.type('html').send(page(login({})))
    })
  )

  // Login handler
  router.post(
    '/login',
    handler(async (req, res) => {
      // Validate
      const handle = req.body?.handle
      if (typeof handle !== 'string' || !isValidHandle(handle)) {
        return res.type('html').send(page(login({ error: 'invalid handle' })))
      }

      // Initiate the OAuth flow
      try {
        const url = await ctx.oauthClient.authorize(handle, {
          scope: 'atproto transition:generic',
        })
        return res.redirect(url.toString())
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed')
        return res.type('html').send(
          page(
            login({
              error:
                err instanceof OAuthResolverError
                  ? err.message
                  : "couldn't initiate login",
            })
          )
        )
      }
    })
  )

  // Logout handler
  router.post(
    '/logout',
    handler(async (req, res) => {
      const session = await getIronSession<Session>(req, res, {
        cookieName: 'sid',
        password: env.COOKIE_SECRET,
      })
      await session.destroy()
      return res.redirect('/')
    })
  )

  // Homepage
  router.get(
    '/',
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx)

      // Fetch data stored in our SQLite
      const statuses = await ctx.db
        .selectFrom('status')
        .selectAll()
        .orderBy('indexedAt', 'desc')
        .limit(10)
        .execute()
      
      // Fetch posts from the new table
      const posts = await ctx.db
        .selectFrom('post')
        .selectAll()
        .orderBy('indexedAt', 'desc')
        .limit(10)
        .execute()
        
      const myStatus = agent
        ? await ctx.db
            .selectFrom('status')
            .selectAll()
            .where('authorDid', '=', agent.assertDid)
            .orderBy('indexedAt', 'desc')
            .executeTakeFirst()
        : undefined

      const myLatestPost = agent
        ? await ctx.db
            .selectFrom('post')
            .selectAll()
            .where('authorDid', '=', agent.assertDid)
            .orderBy('indexedAt', 'desc')
            .executeTakeFirst()
        : undefined

      // Map user DIDs to their domain-name handles (include both statuses and posts)
      const allAuthorDids = [
        ...statuses.map((s) => s.authorDid),
        ...posts.map((p) => p.authorDid)
      ]
      const didHandleMap = await ctx.resolver.resolveDidsToHandles(allAuthorDids)

      if (!agent) {
        // Serve the logged-out view
        return res.type('html').send(page(home({ statuses, posts, didHandleMap })))
      }

      // Fetch additional information about the logged-in user
      const profileResponse = await agent.com.atproto.repo.getRecord({
        repo: agent.assertDid,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
      }).catch(() => undefined);

      const profileRecord = profileResponse?.data;

      const profile = profileRecord &&
        Profile.isRecord(profileRecord.value) &&
        Profile.validateRecord(profileRecord.value).success
          ? profileRecord.value
          : {}

      // Serve the logged-in view
      return res.type('html').send(
        page(
          home({
            statuses,
            posts,
            didHandleMap,
            profile,
            myStatus,
            myLatestPost,
          })
        )
      )
    })
  )

  // "Set status" handler
  router.post(
    '/status',
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res
          .status(401)
          .type('html')
          .send('<h1>Error: Session required</h1>')
      }

      // Construct & validate their status record
      const rkey = TID.nextStr()
      const record = {
        $type: 'xyz.statusphere.status',
        status: req.body?.status,
        createdAt: new Date().toISOString(),
      }
      if (!Status.validateRecord(record).success) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Invalid status</h1>')
      }

      let uri
      try {
        // Write the status record to the user's repository
        const res = await agent.com.atproto.repo.putRecord({
          repo: agent.assertDid,
          collection: 'xyz.statusphere.status',
          rkey,
          record,
          validate: false,
        })
        uri = res.data.uri
      } catch (err) {
        ctx.logger.warn({ err }, 'failed to write record')
        return res
          .status(500)
          .type('html')
          .send('<h1>Error: Failed to write record</h1>')
      }

      try {
        // Optimistically update our SQLite
        // This isn't strictly necessary because the write event will be
        // handled in #/firehose/ingestor.ts, but it ensures that future reads
        // will be up-to-date after this method finishes.
        await ctx.db
          .insertInto('status')
          .values({
            uri,
            authorDid: agent.assertDid,
            status: record.status,
            createdAt: record.createdAt,
            indexedAt: new Date().toISOString(),
          })
          .execute()
      } catch (err) {
        ctx.logger.warn(
          { err },
          'failed to update computed view; ignoring as it should be caught by the firehose'
        )
      }

      return res.redirect('/')
    })
  )

  // "Create post" handler
  router.post(
    '/post',
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx)
      if (!agent) {
        return res
          .status(401)
          .type('html')
          .send('<h1>Error: Session required</h1>')
      }

      // Get and validate the post text
      const text = req.body?.text
      if (typeof text !== 'string' || text.trim().length === 0) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Post text is required</h1>')
      }

      if (text.length > 300) {
        return res
          .status(400)
          .type('html')
          .send('<h1>Error: Post text too long (max 300 characters)</h1>')
      }

      // Parse facets (mentions, links, etc.)
      const facets = parseFacets(text)

      // Detect language
      const langs = detectLanguages(text)

      // Construct the post record
      const rkey = TID.nextStr()
      const record: any = {
        $type: 'app.bsky.feed.post',
        text: text.trim(),
        createdAt: new Date().toISOString(),
      }

      // Add facets if any were found
      if (facets.length > 0) {
        record.facets = facets
      }

      // Add language detection if confident
      if (langs.length > 0) {
        record.langs = langs
      }

      let uri
      try {
        // Write the post record to the user's repository
        const res = await agent.com.atproto.repo.putRecord({
          repo: agent.assertDid,
          collection: 'app.bsky.feed.post',
          rkey,
          record,
          validate: false,
        })
        uri = res.data.uri
      } catch (err) {
        ctx.logger.warn({ err }, 'failed to write post record')
        return res
          .status(500)
          .type('html')
          .send('<h1>Error: Failed to create post</h1>')
      }

      try {
        // Optimistically update our SQLite
        await ctx.db
          .insertInto('post')
          .values({
            uri,
            authorDid: agent.assertDid,
            text: record.text,
            facets: facets.length > 0 ? JSON.stringify(facets) : undefined,
            langs: langs.length > 0 ? JSON.stringify(langs) : undefined,
            createdAt: record.createdAt,
            indexedAt: new Date().toISOString(),
          })
          .execute()
      } catch (err) {
        ctx.logger.warn(
          { err },
          'failed to update computed view; ignoring as it should be caught by the firehose'
        )
      }

      return res.redirect('/')
    })
  )

  return router
}

// Helper functions for post processing

/**
 * Parse facets (mentions, links, hashtags) from text
 */
function parseFacets(text: string): any[] {
  const facets: any[] = []
  
  // Parse mentions (@handle or @did)
  const mentionRegex = /@([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?/g
  let match
  while ((match = mentionRegex.exec(text)) !== null) {
    const handle = match[0].slice(1) // Remove @
    facets.push({
      index: {
        byteStart: Buffer.from(text.slice(0, match.index)).length,
        byteEnd: Buffer.from(text.slice(0, match.index + match[0].length)).length,
      },
      features: [{
        $type: 'app.bsky.richtext.facet#mention',
        did: `did:placeholder:${handle}`, // In a real app, resolve handle to DID
      }],
    })
  }

  // Parse links (http/https URLs)
  const linkRegex = /https?:\/\/[^\s]+/g
  while ((match = linkRegex.exec(text)) !== null) {
    facets.push({
      index: {
        byteStart: Buffer.from(text.slice(0, match.index)).length,
        byteEnd: Buffer.from(text.slice(0, match.index + match[0].length)).length,
      },
      features: [{
        $type: 'app.bsky.richtext.facet#link',
        uri: match[0],
      }],
    })
  }

  // Parse hashtags
  const hashtagRegex = /#[a-zA-Z0-9_]+/g
  while ((match = hashtagRegex.exec(text)) !== null) {
    facets.push({
      index: {
        byteStart: Buffer.from(text.slice(0, match.index)).length,
        byteEnd: Buffer.from(text.slice(0, match.index + match[0].length)).length,
      },
      features: [{
        $type: 'app.bsky.richtext.facet#tag',
        tag: match[0].slice(1), // Remove #
      }],
    })
  }

  return facets
}

/**
 * Simple language detection based on text patterns
 */
function detectLanguages(text: string): string[] {
  const langs: string[] = []
  
  // Very basic heuristics for language detection
  // In a real app, you might use a proper language detection library
  
  // Check for common Portuguese words/patterns
  const portuguesePatterns = /\b(que|uma|para|com|não|mais|como|mas|foi|ele|até|isso|ela|sem|pela|seu|ou|quando|muito|nos|já|está|meu|entre|era|depois|sem|contra|ainda)\b/gi
  const englishPatterns = /\b(the|and|for|are|but|not|you|all|can|had|her|was|one|our|out|day|get|has|him|how|man|new|now|old|see|two|way|who|boy|did|its|let|put|say|she|too|use)\b/gi
  
  const portugueseMatches = (text.match(portuguesePatterns) || []).length
  const englishMatches = (text.match(englishPatterns) || []).length
  
  if (portugueseMatches > englishMatches && portugueseMatches > 0) {
    langs.push('pt')
  } else if (englishMatches > 0) {
    langs.push('en')
  }
  
  return langs
}
