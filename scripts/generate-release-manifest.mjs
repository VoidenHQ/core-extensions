#!/usr/bin/env node
/**
 * Generates dist-bundles/manifest.json listing all built plugins and their versions.
 * Run after build-bundles.mjs. The manifest is uploaded to GitHub Releases alongside
 * the individual plugin .js files so the Voiden app can check for updates.
 */

import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const srcDir = resolve(__dirname, '../src')
const outDir = resolve(__dirname, '../dist-bundles')

const plugins = {}

for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue

  const manifestPath = join(srcDir, entry.name, 'manifest.json')
  const bundlePath = join(outDir, `${entry.name}.js`)

  if (!existsSync(manifestPath) || !existsSync(bundlePath)) continue

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    console.warn(`  ⚠ Skipping ${entry.name}: could not parse manifest.json`)
    continue
  }

  if (!manifest.version) {
    console.warn(`  ⚠ Skipping ${entry.name}: manifest.json missing "version" field`)
    continue
  }

  plugins[entry.name] = {
    version: manifest.version,
    name: manifest.name ?? entry.name,
    file: `${entry.name}.js`,
  }
}

const count = Object.keys(plugins).length
if (count === 0) {
  console.error('No built bundles found in dist-bundles/. Run build-bundles first.')
  process.exit(1)
}

const releaseManifest = {
  generatedAt: new Date().toISOString(),
  plugins,
}

const outFile = join(outDir, 'manifest.json')
writeFileSync(outFile, JSON.stringify(releaseManifest, null, 2))
console.log(`✓ Generated dist-bundles/manifest.json with ${count} plugin(s)`)
