/**
 * Plugin Adapter for Voiden Faker Extension
 *
 * This adapter wraps the UIExtension to work with the plugin system.
 */

import { VoidenFakerExtension } from './extension';
import { mountFakerHoverTooltip, unmountFakerHoverTooltip } from './lib/fakerHoverTooltip';

import type { CorePluginContext } from '../types/plugin-context';

const voidenFakerPlugin = (context: CorePluginContext) => {
  // Create extension instance
  const extension = new VoidenFakerExtension();

  // Store references to registered extensions for cleanup
  let fakerSuggestionExtension: any = null;
  let fakerAutocompleteExtension: any = null;

  // Create a minimal UIExtensionContext that maps to PluginContext
  const createExtensionContext = () => {
    return {
      pipeline: {
        registerHook: async (stage: string, handler: any, priority?: number) => {
          await context.pipeline.registerHook(stage, handler, priority);
        },
      },
      metadata: {
        name: extension.name,
        version: extension.version,
        description: extension.description,
        author: extension.author,
        icon: extension.icon,
      },
    };
  };

  return {
    onload: async () => {
      mountFakerHoverTooltip();

      // Register Tiptap suggestion extension dynamically
      const { FakerSuggestion } = await import('./lib/fakerSuggestion');
      fakerSuggestionExtension = FakerSuggestion;
      context.registerVoidenExtension(FakerSuggestion);

      // Register CodeMirror autocomplete extension dynamically
      const { fakerAutocomplete } = await import('./lib/fakerAutocomplete');
      fakerAutocompleteExtension = fakerAutocomplete();
      context.registerCodemirrorExtension(fakerAutocompleteExtension);

      // Inject context into extension
      const extensionContext = createExtensionContext();
      (extension as any)._setContext(extensionContext);

      // Call extension's onLoad (registers pipeline hook)
      await extension.onLoad();

    },

    onunload: async () => {
      unmountFakerHoverTooltip();
      await extension.onUnload?.();

      // Unregister Tiptap extension
      if (fakerSuggestionExtension) {
        context.unregisterVoidenExtension('fakerSuggestion');
      }

      // Unregister CodeMirror extension
      if (fakerAutocompleteExtension) {
        context.unregisterCodemirrorExtension(fakerAutocompleteExtension);
      }

      // Unregister hooks
      try {
        await context.pipeline.unregister();
      } catch (error) {
      }
    },
  };
};

export default voidenFakerPlugin;
