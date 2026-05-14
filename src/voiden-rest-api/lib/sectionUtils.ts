/**
 * Section Utilities
 *
 * Helpers for splitting a .void document into independent request sections
 * separated by request-separator nodes.
 *
 * A "section" is all root-level nodes between two separators (or doc boundary).
 * Section 0 = everything before the first separator.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";

const SEPARATOR_TYPE = "request-separator";

/**
 * Split a ProseMirror doc's children into sections.
 * Returns an array of sections, where each section is an array of child nodes
 * with their starting positions in the document.
 */
export function getSectionsFromDoc(doc: ProseMirrorNode): { node: ProseMirrorNode; pos: number }[][] {
  const sections: { node: ProseMirrorNode; pos: number }[][] = [[]];

  doc.forEach((child, offset) => {
    if (child.type.name === SEPARATOR_TYPE) {
      sections.push([]);
    } else {
      sections[sections.length - 1].push({ node: child, pos: offset + 1 }); // +1 for doc open tag
    }
  });

  return sections;
}

/**
 * Get the section index that contains a given document position.
 */
export function getSectionIndexAtPos(doc: ProseMirrorNode, pos: number): number {
  let sectionIndex = 0;

  doc.forEach((child, offset) => {
    const nodeStart = offset + 1; // +1 for doc open tag
    const nodeEnd = nodeStart + child.nodeSize;

    if (child.type.name === SEPARATOR_TYPE && pos >= nodeEnd) {
      sectionIndex++;
    }
  });

  return sectionIndex;
}

/**
 * Get the root-level nodes in the section containing a given position.
 * This is used for section-scoped singleton enforcement.
 */
export function getSectionNodesAtPos(doc: ProseMirrorNode, pos: number): ProseMirrorNode[] {
  const sections = getSectionsFromDoc(doc);
  const sectionIndex = getSectionIndexAtPos(doc, pos);
  const section = sections[sectionIndex] || [];
  return section.map((entry) => entry.node);
}

/**
 * Split JSONContent (editor.getJSON()) into section arrays.
 * Used for request compilation where we work with JSON, not ProseMirror nodes.
 */
export function getSectionsFromJSON(content: JSONContent[]): JSONContent[][] {
  const sections: JSONContent[][] = [[]];

  for (const node of content) {
    if (node.type === SEPARATOR_TYPE) {
      sections.push([]);
    } else {
      sections[sections.length - 1].push(node);
    }
  }

  return sections;
}

/**
 * Extract a section-scoped document from a full editor JSON.
 * The returned doc contains only the nodes in the section at sectionIndex.
 * Existing functions like getRequest() work unchanged on this scoped doc.
 */
export function extractSectionDocByIndex(editorJson: JSONContent, sectionIndex: number): JSONContent {
  const sections = getSectionsFromJSON(editorJson.content || []);
  return {
    type: "doc",
    content: sections[sectionIndex] || [],
  };
}

/**
 * Given full editor JSON and a position, return a scoped doc for that section.
 * This is the main entry point for request compilation scoping.
 */
export function extractSectionDocAtPos(editorJson: JSONContent, doc: ProseMirrorNode, pos: number): JSONContent {
  const sectionIndex = getSectionIndexAtPos(doc, pos);
  return extractSectionDocByIndex(editorJson, sectionIndex);
}

/**
 * Check if a document has any request-separator nodes (i.e., is multi-request).
 */
export function hasMultipleSections(doc: ProseMirrorNode): boolean {
  let found = false;
  doc.forEach((child) => {
    if (child.type.name === SEPARATOR_TYPE) {
      found = true;
    }
  });
  return found;
}
