/**
 * voiden-rest-api — headless block parser.
 *
 * Parses REST request blocks from a parsed .void document (array of Block
 * objects) and returns a RestApiRequestState ready for executeRequestPipeline.
 *
 * No RunnerContext, no React — pure Node.js-compatible parsing logic.
 *
 * Default export: RunnerFactory — called by voiden-runner's plugin loader.
 * Named export:   buildRequest  — available for direct use / testing.
 */

import type { RunnerFactory, RunnerContext, Block, CliRequestState } from '@voiden/sdk/runner'

type RestApiRequestState = CliRequestState

type Row = { key: string; value: string; enabled: boolean }

function extractRows(block: any): Row[] {
  const rows: Row[] = []
  if (!Array.isArray(block.content)) return rows
  for (const child of block.content) {
    if (child.type === 'table' && Array.isArray(child.rows)) {
      for (const r of child.rows) {
        const disabled = r.attrs?.disabled === true
        if (Array.isArray(r.row) && r.row.length >= 2) {
          const key   = String(r.row[0] ?? '').trim()
          const value = String(r.row[1] ?? '').trim()
          if (key) rows.push({ key, value, enabled: !disabled })
        }
      }
    }
  }
  return rows
}

/**
 * Try to parse a REST request from an array of blocks.
 * Returns null when the blocks do not contain a REST request
 * (e.g. GraphQL or socket blocks are present instead).
 */
export function buildRequest(blocks: Block[]): RestApiRequestState | null {
  // Defer to specialised parsers
  if (blocks.some((b: any) => b.type === 'gqlquery'))       return null
  if (blocks.some((b: any) => b.type === 'socket-request')) return null

  const requestBlock = blocks.find((b: any) => b.type === 'request')
  if (!requestBlock) return null

  let method = 'GET'
  let url = ''
  if (Array.isArray(requestBlock.content)) {
    for (const node of requestBlock.content) {
      if (node.type === 'method' && typeof node.content === 'string')
        method = node.content.trim().toUpperCase() || 'GET'
      if (node.type === 'url' && typeof node.content === 'string')
        url = node.content.trim()
    }
  }
  if (!url) return null

  const headers     = extractRows(blocks.find((b: any) => b.type === 'headers-table') ?? {})
  const queryParams = extractRows(blocks.find((b: any) => b.type === 'query-table')   ?? {})
  const pathParams  = extractRows(blocks.find((b: any) => b.type === 'path-table')    ?? {})

  let body: string | undefined
  let contentType: string | undefined

  const jsonBody = blocks.find((b: any) => b.type === 'json_body')
  if (jsonBody?.attrs?.body) {
    body = String(jsonBody.attrs.body)
    const ct = jsonBody.attrs.contentType
    contentType = ct === 'html' ? 'text/html' : ct === 'text' ? 'text/plain' : 'application/json'
  }

  const xmlBody = blocks.find((b: any) => b.type === 'xml_body')
  if (xmlBody?.attrs?.body) {
    body = String(xmlBody.attrs.body)
    const xmlTypes = ['application/xml', 'text/xml', 'application/xhtml+xml']
    contentType = xmlTypes.includes(xmlBody.attrs.contentType)
      ? xmlBody.attrs.contentType
      : 'application/xml'
  }

  const ymlBody = blocks.find((b: any) => b.type === 'yml_body')
  if (ymlBody?.attrs?.body) {
    body = String(ymlBody.attrs.body)
    const yamlTypes = ['application/x-yaml', 'application/yaml', 'text/yaml', 'text/x-yaml']
    contentType = yamlTypes.includes(ymlBody.attrs.contentType)
      ? ymlBody.attrs.contentType
      : 'application/x-yaml'
  }

  return {
    method,
    url,
    headers,
    queryParams,
    pathParams,
    body,
    contentType,
    metadata: {},
  }
}

// ─── RunnerFactory ────────────────────────────────────────────────────────────
// voiden-runner loads this default export and calls onload() with a headless
// context.  The plugin registers its buildRequest function so the runner can
// convert REST blocks into a request state without hardcoded imports.
// REST is the catch-all parser — it returns null for GraphQL and socket blocks
// so more specific parsers can be registered alongside it.

const createRestApiRunner: RunnerFactory = (context: RunnerContext) => {
  return {
    onload() {
      // ── Request builder ───────────────────────────────────────────────────
      // Registers with the shared RequestOrchestrator. If this plugin is disabled
      // its handler is never registered → REST requests fail gracefully.
      context.onBuildRequest((request, blocks) => {
        const built = buildRequest(blocks)
        return built ?? request
      })
    },
  }
}

export default createRestApiRunner

