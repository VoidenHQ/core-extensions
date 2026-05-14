import type { RunnerFactory, RunnerContext } from '@voiden/sdk/runner'

/**
 * voiden-faker — headless pipeline hook runner.
 *
 * Registers the pre-send Faker variable replacement hook.
 * No React, no DOM — pure Node.js-compatible logic.
 *
 * Hook lazily imports its implementation at invocation time to avoid
 * Node.js ESM extension-resolution issues in the lib/* chain.
 *
 * Default export: RunnerFactory — called by voiden-runner's plugin loader.
 */

const createVoidenFakerRunner: RunnerFactory = (context: RunnerContext) => {
  return {
    onload() {
      // Pre-send: replace {{$faker.*}} variables in the request (priority 10)
      context.pipeline.registerHook(
        'pre-send',
        async (ctx: any) => {
          const { preSendFakerHook } = await import('./lib/pipelineHook.js')
          await preSendFakerHook(ctx)
        },
        10,
      )
    },
  }
}

export default createVoidenFakerRunner

