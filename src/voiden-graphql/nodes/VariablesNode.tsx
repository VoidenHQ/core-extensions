/**
 * GraphQL Variables Node
 *
 * JSON editor for GraphQL variables — mirrors the JSON body block patterns
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Sparkles } from "lucide-react";

const prettifyJSON = (json: string) => {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
};

export const createGraphQLVariablesNode = (NodeViewWrapper: any, CodeEditor: any, RequestBlockHeader: any) => {
  const Actions = ({ setText }: { setText: () => void }) => {
    return (
      <button
        className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono text-comment hover:text-text transition-colors opacity-60 hover:opacity-100"
        onClick={setText}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <Sparkles size={11} />
        <span>PRETTIFY</span>
      </button>
    );
  };

  const GraphQLVariablesComponent = (props: any) => {
    const [shouldAutofocus, setShouldAutofocus] = React.useState(false);

    // Check if this is an imported/linked block
    const isImported = !!props.node.attrs.importedFrom;
    const isEditable = props.editor.isEditable;

    // Ensure the node always has a valid JSON body with proper formatting
    React.useEffect(() => {
      if (!isEditable) return;
      let body = props.node.attrs.body;

      // Handle case where body was parsed as an object instead of a string
      if (typeof body === 'object' && body !== null) {
        try {
          body = JSON.stringify(body, null, 2);
          props.updateAttributes({ body });
          return;
        } catch {
          body = '{\n  \n}';
        }
      }

      if (!body || (typeof body === 'string' && (body.trim() === '' || body === '{}'))) {
        props.updateAttributes({ body: '{\n  \n}' });
      }
    }, []);

    // Handle autofocus on creation (only for non-imported blocks)
    React.useEffect(() => {
      if (!isImported && props.editor.storage.gqlvariables?.shouldFocusNext) {
        setShouldAutofocus(true);
        const timer = setTimeout(() => {
          if (props.editor.storage.gqlvariables) {
            props.editor.storage.gqlvariables.shouldFocusNext = false;
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [props.editor.storage.gqlvariables?.shouldFocusNext, isImported]);

    const handlePrettify = () => {
      try {
        const currentValue = props.node.attrs.body || '{}';
        const prettified = prettifyJSON(currentValue);
        props.updateAttributes({ body: prettified });
      } catch {}
    };

    return (
      <NodeViewWrapper>
        <div className="my-2">
          <RequestBlockHeader
            title="GRAPHQL-VARIABLES"
            withBorder={false}
            editor={props.editor}
            actions={!isImported && isEditable ? <Actions setText={handlePrettify} /> : undefined}
          />
          <div style={{ height: 'auto' }}>
            <CodeEditor
              tiptapProps={props}
              lang="jsonc"
              showReplace={false}
              autofocus={shouldAutofocus && isEditable && !isImported}
              readOnly={isImported || !isEditable}
            />
          </div>
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "gqlvariables",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        body: {
          default: '{\n  \n}',
          parseHTML: (element: any) => {
            const content = element.textContent || "";
            try {
              return content ? JSON.stringify(JSON.parse(content), null, 2) : '{\n  \n}';
            } catch {
              return content || '{\n  \n}';
            }
          },
        },
        importedFrom: {
          default: undefined,
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: "gqlvariables",
          getAttrs: (element: any) => {
            const body = element.textContent;
            return { body };
          },
        },
      ];
    },

    renderHTML({ HTMLAttributes }: any) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { class: "gql-variables-block" }),
      ];
    },

    addStorage() {
      return {
        shouldFocusNext: true,
      };
    },

    addNodeView() {
      return ReactNodeViewRenderer(GraphQLVariablesComponent);
    },

    addKeyboardShortcuts() {
      return {
        Backspace: ({ editor }: any) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'gqlvariables') {
            return true;
          }
          return false;
        },
        Delete: ({ editor }: any) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'gqlvariables') {
            return true;
          }
          return false;
        },
      };
    },
  });
};

export const GraphQLVariablesNode = createGraphQLVariablesNode(
  ({ children }: any) => <div>{children}</div>,
  () => <div>CodeEditor not available</div>,
  () => <div>Header not available</div>
);
