#!/usr/bin/env node
/**
 * Builds each core extension plugin as a separate ESM bundle for GitHub Releases.
 * Output: dist-bundles/{plugin-id}.js
 *
 * React and react-dom are NOT bundled — they are shimmed from window.__voiden_shims__
 * which the host app populates before any plugin loads.
 */

import { build } from 'vite'
import { readdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const srcDir = resolve(__dirname, '../src')
const outDir = resolve(__dirname, '../dist-bundles')

/**
 * Rollup plugin that replaces host-app imports with inline code reading from
 * window.__voiden_shims__ (populated by the host app before any plugin loads).
 *
 * Covers two categories:
 *  1. React/ReactDOM — must share the host instance so hooks work.
 *  2. @/core/* — Vite path-alias modules from the host app that plugins
 *     access via dynamic import(). These are shimmed so plugin bundles
 *     resolve them without needing the host's Vite build context.
 */
function voidenShimsPlugin() {
  // Statically-known named exports for modules that use ESM static imports.
  const STATIC_SHIMS = {
    'react': `\
const _s = window.__voiden_shims__['react'];
export default _s;
export const { useState, useEffect, useCallback, useMemo, useRef, useContext,
  createContext, forwardRef, memo, Fragment, createElement, cloneElement,
  Children, StrictMode, Suspense, lazy, isValidElement, Component,
  PureComponent, createRef, startTransition, useReducer, useLayoutEffect,
  useImperativeHandle, useDebugValue, useTransition, useDeferredValue, useId } = _s;`,

    'react-dom': `\
const _s = window.__voiden_shims__['react-dom'];
export default _s;
export const { createPortal, flushSync, render, unmountComponentAtNode } = _s;`,

    'react/jsx-runtime': `\
const _s = window.__voiden_shims__['react/jsx-runtime'];
export const jsx = _s.jsx;
export const jsxs = _s.jsxs;
export const Fragment = _s.Fragment;`,

    'react-dom/client': `\
const _s = window.__voiden_shims__['react-dom/client'];
export default _s;
export const { createRoot, hydrateRoot } = _s;`,
  }

  // @/core/* modules are always accessed via dynamic import() with destructuring,
  // so we only need a default export pointing at the shim object.
  // The consumer does: const { foo } = await import('@/core/...')
  // which in ESM resolves to named exports, so we spread all known keys.
  const CORE_EXPORTS = {
    '@/core/file-system/hooks/useFileSystem': ['prosemirrorToMarkdown'],
    '@/core/editors/voiden/extensions': ['voidenExtensions'],
    '@/core/editors/voiden/VoidenEditor': ['useEditorStore', 'useVoidenEditorStore', 'proseClasses'],
    '@/core/editors/voiden/utils/expandLinkedBlocks': ['expandLinkedBlocksInDoc'],
    '@/core/editors/voiden/markdownConverter': ['parseMarkdown'],
    '@/core/request-engine/getRequestFromJson': ['getTable', 'parseAuthNode', 'buildHeadersWithCookies', 'findNode', 'findNodes', 'createNewRequestObject', 'getRequest'],
    '@/core/request-engine/stores/responseStore': ['useResponseStore'],
    '@/core/request-engine/requestOrchestrator': ['requestOrchestrator'],
    '@/core/request-engine/runtimeVariables': ['replaceProcessVariablesInText'],
    '@/core/request-engine/pipeline': ['hookRegistry', 'PipelineStage'],
    '@/core/history/adapterRegistry': ['historyAdapterRegistry'],
    '@/core/stores/panelStore': ['usePanelStore'],
    '@/core/stores/responsePanelPosition': ['getResponsePanelPosition'],
    '@/core/environment/hooks': ['useActiveEnvironment', 'useEnvironments'],
    // Host app module aliases
    '@/plugins': ['useEditorEnhancementStore', 'usePluginStore'],
    '@/main': ['getQueryClient'],
  }

  return {
    name: 'voiden-shims',
    resolveId(id) {
      if (id in STATIC_SHIMS) return `\0voiden-shim:${id}`
      if (id in CORE_EXPORTS) return `\0voiden-shim:${id}`
      return null
    },
    load(id) {
      if (!id.startsWith('\0voiden-shim:')) return null
      const mod = id.slice('\0voiden-shim:'.length)

      if (mod in STATIC_SHIMS) return STATIC_SHIMS[mod]

      // @/core/* module: re-export known named exports from the shim object
      const exports = CORE_EXPORTS[mod] || []
      const key = JSON.stringify(mod)
      const namedLines = exports.map(name => `export const ${name} = _s.${name};`).join('\n')
      return `const _s = (window.__voiden_shims__ || {})[${key}] || {};\nexport default _s;\n${namedLines}`
    },
  }
}

// Discover all plugin directories (must have manifest.json + plugin.ts)
const plugins = readdirSync(srcDir, { withFileTypes: true })
  .filter(e => {
    if (!e.isDirectory()) return false
    return (
      existsSync(join(srcDir, e.name, 'manifest.json')) &&
      existsSync(join(srcDir, e.name, 'plugin.ts'))
    )
  })
  .map(e => e.name)

if (plugins.length === 0) {
  console.error('No plugins found in src/')
  process.exit(1)
}

console.log(`Building ${plugins.length} plugin bundle(s): ${plugins.join(', ')}\n`)

let failed = 0
for (const pluginId of plugins) {
  const entry = join(srcDir, pluginId, 'plugin.ts')
  process.stdout.write(`  Building ${pluginId}...`)

  try {
    await build({
      configFile: false,
      plugins: [
        voidenShimsPlugin(),
        // Treat CSS imports as empty modules — host app handles styling
        {
          name: 'skip-css',
          resolveId(id) { if (id.endsWith('.css')) return '\0empty-css' },
          load(id) { if (id === '\0empty-css') return 'export default {}' },
        },
      ],
      esbuild: {
        jsx: 'automatic',
      },
      build: {
        lib: {
          entry,
          formats: ['es'],
          fileName: () => `${pluginId}.js`,
        },
        outDir,
        emptyOutDir: false,
        minify: true,
        sourcemap: false,
        rollupOptions: {
          output: {
            // Inline all dynamic imports so the output is a single self-contained file.
            // Without this, Vite splits lazy imports into separate chunks that the
            // OTA downloader would also need to fetch.
            inlineDynamicImports: true,
          },
        },
      },
      logLevel: 'silent',
    })
    console.log(' ✓')
  } catch (err) {
    console.log(' ✗')
    console.error(`    Error: ${err.message}\n`)
    failed++
  }
}

console.log(`\n${plugins.length - failed}/${plugins.length} bundles built successfully.`)
if (failed > 0) {
  console.error(`${failed} build(s) failed.`)
  process.exit(1)
}
