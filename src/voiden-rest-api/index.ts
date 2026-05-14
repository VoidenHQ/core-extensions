/**
 * Voiden REST API Extension
 *
 * Entry point for the REST API extension
 */

export { VoidenRestApiExtension } from './extension.js';

// Export converter utilities for other extensions
export * from './lib/converter.js';
export { restApiSlashGroup } from './lib/slashCommands.js';

// Export request population utilities
export * from './lib/requestPopulator.js';

// Export parser utilities
export * from './lib/parser/types.js';
export { convert as convertCurlToRequest } from './lib/parser/importers/curl.js';

// Export utilities
export * from './lib/utils.js';

// Export curl paste utilities
export { handleCurl, pasteCurl } from './nodes/curlPaste.js';

// Export plugin adapter for legacy plugin system (default export)
export { default } from './plugin.js';
