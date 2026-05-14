/**
 * TEMPORARY — remove this file and the "@voiden/sdk/runner" paths entry in
 * tsconfig.json once @voiden/sdk is published with the ./runner subpath export.
 */

export interface Block {
  type: string
  attrs?: Record<string, any>
  content?: Block[] | string
}

export interface CliRequestState {
  method: string
  url: string
  headers: Array<{ key: string; value: string; enabled?: boolean }>
  queryParams: Array<{ key: string; value: string; enabled?: boolean }>
  pathParams?: Array<{ key: string; value: string; enabled?: boolean }>
  body?: string
  contentType?: string
  metadata?: Record<string, any>
}

export interface CliResponseState {
  protocol: string
  method?: string
  url: string
  status?: number
  statusText?: string
  durationMs: number
  size?: number
  body?: string
  error?: string
  connected?: boolean
  metadata?: Record<string, any>
}

export interface BlockAttrDef {
  default?: any
}

export interface BlockSchemaDef {
  name: string
  attrs: Record<string, BlockAttrDef>
}

export type CliReportEntry =
  | { type: 'log'; level: 'info' | 'warn' | 'error' | 'debug'; message: string }
  | { type: 'assertion'; passed: boolean; message: string; actual?: any; expected?: any; operator?: string }
  | { type: 'section'; title: string }

export type RunnerRequestHandler = (
  request: CliRequestState,
  blocks: Block[]
) => CliRequestState | void | Promise<CliRequestState | void>

export type RunnerResponseHandler = (
  response: CliResponseState,
  blocks: Block[],
  request: CliRequestState
) => void | Promise<void>

export interface RunnerReportAPI {
  add(entry: CliReportEntry): void
  getEntries(): CliReportEntry[]
}

export interface RunnerContext {
  onBuildRequest(handler: RunnerRequestHandler): void
  onProcessResponse(handler: RunnerResponseHandler): void
  pipeline: {
    registerHook(stage: string, handler: any, priority?: number): void
  }
  registerBlockSchema(def: BlockSchemaDef): void
  protocols?: {
    executeWebSocket(req: any): Promise<any>
    executeGrpc(req: any): Promise<any>
  }
  verbose: boolean
  report: RunnerReportAPI
}

export type RunnerFactory = (context: RunnerContext) => { onload(): void | Promise<void> }
