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
 * Rollup plugin that replaces React/ReactDOM imports with inline code that reads
 * from window.__voiden_shims__ (populated by the host app at startup).
 * This ensures the plugin shares the host's React instance — required for hooks to work.
 */
function voidenShimsPlugin() {
  const SHIMS = {
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

  return {
    name: 'voiden-shims',
    resolveId(id) {
      if (id in SHIMS) return `\0voiden-shim:${id}`
      return null
    },
    load(id) {
      if (!id.startsWith('\0voiden-shim:')) return null
      return SHIMS[id.slice('\0voiden-shim:'.length)]
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
      plugins: [voidenShimsPlugin()],
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
