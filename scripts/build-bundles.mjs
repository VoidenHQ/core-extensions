#!/usr/bin/env node
/**
 * Builds each core extension plugin as a separate ESM bundle for GitHub Releases.
 * Output: dist-bundles/{plugin-id}.js
 *
 * React and react-dom are NOT bundled — they are shimmed from window.__voiden_shims__
 * which the host app populates before any plugin loads.
 */

import { build } from 'vite'
import { readdirSync, existsSync, readFileSync } from 'fs'
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

    // @tanstack/react-query — must share host instance so QueryClientContext matches.
    // If the plugin bundles its own react-query it creates a new QueryClientContext,
    // which is invisible to the host's QueryClientProvider → useQuery fails → "Invalid hook call".
    '@tanstack/react-query': `\
const _s = window.__voiden_shims__['@tanstack/react-query'];
export default _s;
export const { useQuery, useMutation, useQueryClient, useInfiniteQuery,
  QueryClient, QueryClientProvider, QueryCache, MutationCache,
  useIsFetching, useIsMutating, useSuspenseQuery, useSuspenseInfiniteQuery,
  useSuspenseQueries, useQueries, HydrationBoundary, dehydrate, hydrate,
  focusManager, onlineManager, replaceEqualDeep, hashKey } = _s;`,

    // @tiptap/react — must share host instance so NodeViewWrapper React context matches
    // ReactNodeViewRenderer (in plugins) and NodeViewWrapper (from host context) must
    // use the same @tiptap/react so node-view context lookups work and hooks don't fail.
    '@tiptap/react': `\
const _s = window.__voiden_shims__['@tiptap/react'];
export default _s;
export const { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent,
  useEditor, EditorContent, ReactRenderer, FloatingMenu, BubbleMenu,
  useReactNodeView, useCurrentEditor } = _s;`,

    // CodeMirror — must share host instances so extension instanceof checks pass
    '@codemirror/state': `\
const _s = window.__voiden_shims__['@codemirror/state'];
export default _s;
export const { Extension, RangeSetBuilder, StateField, EditorState, Prec,
  Annotation, AnnotationType, ChangeDesc, ChangeSet, Compartment, EditorSelection,
  Facet, Line, MapMode, Range, RangeSet, RangeValue, SelectionRange,
  StateEffect, StateEffectType, Text, Transaction, combineConfig,
  countColumn, findClusterBreak, findColumn } = _s;`,

    '@codemirror/view': `\
const _s = window.__voiden_shims__['@codemirror/view'];
export default _s;
export const { keymap, EditorView, Decoration, DecorationSet, WidgetType,
  ViewPlugin, ViewUpdate, MatchDecorator, GutterMarker,
  drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars,
  lineNumbers, rectangularSelection, scrollPastEnd } = _s;`,

    '@codemirror/autocomplete': `\
const _s = window.__voiden_shims__['@codemirror/autocomplete'];
export default _s;
export const { CompletionContext, CompletionResult, autocompletion,
  completeAnyWord, closeBrackets, closeBracketsKeymap,
  completionKeymap, ifIn, ifNotIn, snippetCompletion } = _s;`,
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

// Discover all plugin directories (must have manifest.json + plugin.ts or index.ts)
const ENTRY_CANDIDATES = ['plugin.ts', 'index.ts']

const plugins = readdirSync(srcDir, { withFileTypes: true })
  .filter(e => {
    if (!e.isDirectory()) return false
    if (!existsSync(join(srcDir, e.name, 'manifest.json'))) return false
    return ENTRY_CANDIDATES.some(f => existsSync(join(srcDir, e.name, f)))
  })
  .map(e => e.name)

if (plugins.length === 0) {
  console.error('No plugins found in src/')
  process.exit(1)
}

console.log(`Building ${plugins.length} plugin bundle(s): ${plugins.join(', ')}\n`)

let failed = 0
for (const pluginId of plugins) {
  const entry = ENTRY_CANDIDATES.map(f => join(srcDir, pluginId, f)).find(p => existsSync(p))
  if (!entry) {
    console.log(` ✗ (no entry file found)`)
    failed++
    continue
  }
  process.stdout.write(`  Building ${pluginId}...`)

  try {
    await build({
      configFile: false,
      plugins: [
        // Stamp every bundle with a shim compatibility version and the plugin's manifest metadata.
        // The host uses __voiden_bundle_version__ to skip stale bundles, and __voiden_manifest__
        // to update the extension's description, readme, and capabilities shown in the UI.
        {
          name: 'inject-bundle-version',
          renderChunk(code) {
            const manifestPath = join(srcDir, pluginId, 'manifest.json')
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
            const prefix = [
              `export const __voiden_bundle_version__ = 2;`,
              `export const __voiden_manifest__ = ${JSON.stringify(manifest)};`,
            ].join('\n')
            return { code: `${prefix}\n${code}`, map: null }
          },
        },
        voidenShimsPlugin(),
        // Treat CSS imports as empty modules — host app handles styling
        {
          name: 'skip-css',
          resolveId(id) { if (id.endsWith('.css')) return '\0empty-css' },
          load(id) { if (id === '\0empty-css') return 'export default {}' },
        },
        // Redirect Node's `buffer` module to globalThis.Buffer (available in Electron).
        // enforce:'pre' ensures this runs before Vite's browser-external plugin,
        // which would otherwise intercept `buffer` first and return an empty module.
        {
          name: 'node-buffer',
          enforce: 'pre',
          resolveId(id) { if (id === 'buffer') return '\0node-buffer' },
          load(id) {
            if (id === '\0node-buffer') return [
              'export const Buffer = globalThis.Buffer',
              'export default { Buffer: globalThis.Buffer }',
            ].join('\n')
          },
        },
        // Stub out self-imports of @voiden/core-extensions.
        // The SDK (a dependency) transitively imports the package itself. Since the
        // dist/ folder doesn't exist in CI (no tsc step), resolution fails. Only
        // type-level values are imported so an empty stub is safe.
        {
          name: 'self-import-stub',
          enforce: 'pre',
          resolveId(id) {
            if (id === '@voiden/core-extensions' || id.startsWith('@voiden/core-extensions/')) {
              return '\0self-voiden-ext'
            }
          },
          load(id) {
            if (id === '\0self-voiden-ext') return 'export default {}; export const coreExtensions = []; export const coreExtensionPlugins = {};'
          },
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
          onwarn(warning, warn) {
            // Suppress "use client" directive warnings from react-query / lucide-react
            if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
            warn(warning)
          },
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
