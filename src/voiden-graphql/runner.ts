import type { RunnerFactory, RunnerContext, Block, CliRequestState } from '@voiden/sdk/runner'

/**
 * voiden-graphql — headless block parser.
 *
 * Parses GraphQL query/mutation/subscription blocks and builds the HTTP POST
 * RestApiRequestState used by executeRequestPipeline.
 *
 * No RunnerContext, no React — pure Node.js-compatible parsing logic.
 *
 * Default export: RunnerFactory — called by voiden-runner's plugin loader.
 * Named export:   buildRequest  — available for direct use / testing.
 */

type RestApiRequestState = CliRequestState

export function buildRequest(blocks: Block[]): RestApiRequestState | null {
  const gqlBlock = blocks.find((b: any) => b.type === 'gqlquery')
  if (!gqlBlock) return null

  const body = (gqlBlock.content as any[] | undefined)?.find((c: any) => c.type === 'gqlbody')|| ''
  const query = body.attrs?.body || ''
  if (!query.trim()) return {errorMessage: 'GraphQL query is empty'} as any

  let operationType = body.attrs?.operationType || 'query'
  let operationName: string | undefined = body.attrs?.operationName
  if (!operationName) {
    const m = query.match(/^\s*(query|mutation|subscription)\s+([\w]+)?/)
    if (m) { operationType = m[1]; operationName = m[2] }
  }

  let variables: Record<string, any> = {}
  const varBlock = blocks.find((b: any) => b.type === 'gqlvariables')
  if (varBlock?.attrs?.body) {
    try { variables = JSON.parse(varBlock.attrs.body) } catch { /* ignore */ }
  }

  let url = ''
  const requestBlock = gqlBlock;
  if (requestBlock && Array.isArray(requestBlock.content)) {
    const urlNode = requestBlock.content.find((n: any) => n.type === 'gqlurl')
    if (urlNode && typeof urlNode.content === 'string') url = urlNode.content.trim()
  }
  if (!url) url = gqlBlock.attrs?.endpoint || gqlBlock.attrs?.schemaUrl || ''
  if (!url) return {errorMessage: 'GraphQL url is empty'} as any

  const headers: Array<{ key: string; value: string; enabled: boolean }> = [
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]
  const headersBlock = blocks.find((b: any) => b.type === 'headers-table')
  if (headersBlock && Array.isArray(headersBlock.content)) {
    for (const child of headersBlock.content as any[]) {
      if (child.type === 'table' && Array.isArray(child.rows)) {
        for (const r of child.rows) {
          if (!r.attrs?.disabled && Array.isArray(r.row) && r.row[0]) {
            const key   = String(r.row[0]).trim()
            const value = String(r.row[1] ?? '').trim()
            const idx   = headers.findIndex(h => h.key.toLowerCase() === key.toLowerCase())
            if (idx >= 0) headers[idx].value = value
            else headers.push({ key, value, enabled: true })
          }
        }
      }
    }
  }

  const bodyObj: any = { query, variables }
  if (operationName) bodyObj.operationName = operationName

  return {
    method: 'POST',
    url,
    headers,
    queryParams: [],
    pathParams:  [],
    body:        JSON.stringify(bodyObj),
    contentType: 'application/json',
    metadata:    { operationType, operationName },
  }
}

// ─── RunnerFactory ────────────────────────────────────────────────────────────
// voiden-runner loads this default export and calls onload() with a headless
// context.  The plugin registers its buildRequest function so the runner can
// convert GraphQL blocks into a request state without hardcoded imports.

const createGraphQLRunner: RunnerFactory = (context: RunnerContext) => {
  return {
    onload() {
      // ── Request builder ───────────────────────────────────────────────────
      // Registers with the shared RequestOrchestrator. If this plugin is disabled
      // its handler is never registered → GraphQL requests fail gracefully.
      context.onBuildRequest((request, blocks) => {
        const built = buildRequest(blocks)
        return built ?? request
      })
    },
  }
}

export default createGraphQLRunner

