import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "800", fontSize: "1.3em" },
  { tag: tags.heading2, fontWeight: "800", fontSize: "1.18em" },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: "800" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.processingInstruction, tags.contentSeparator], color: "var(--color-muted)" },
  { tag: [tags.link, tags.url], color: "var(--color-note)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--color-added-ink)" },
  { tag: tags.quote, color: "var(--color-ink-2)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--color-warn)" },
  { tag: tags.meta, color: "var(--color-muted)" },
]);

const theme = EditorView.theme({
  "&": { color: "var(--color-ink)", backgroundColor: "var(--color-paper)", height: "100%", minHeight: "60dvh" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "0.9rem", lineHeight: "1.7", padding: "var(--space-lg) 0", fontVariantLigatures: "none" },
  ".cm-content": { caretColor: "var(--color-ink)", padding: "0 var(--space-lg)", maxWidth: "80ch" },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "var(--color-paper-2)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--color-accent) !important", color: "var(--color-accent-ink)" },
  ".cm-cursor": { borderLeft: "2px solid var(--color-ink)" },
  ".cm-placeholder": { color: "var(--color-muted)" },
});

export const createCodeEditor = ({ parent, doc, wrap, onChange, onCursor, keys, onFiles }) => {
  const wrapping = new Compartment();
  const shadow = parent.shadowRoot ?? parent.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  shadow.replaceChildren(mount);
  const view = new EditorView({
    parent: mount,
    root: shadow,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlight),
        theme,
        placeholder("Write Markdown here"),
        wrapping.of(wrap ? EditorView.lineWrapping : []),
        keymap.of([...keys, indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.contentAttributes.of({ "aria-label": "Markdown source", spellcheck: "true" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) onCursor(update.state);
        }),
        EditorView.domEventHandlers({
          paste: (event) => {
            const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
            if (!files.length) return false;
            event.preventDefault();
            onFiles(files);
            return true;
          },
          drop: (event, view) => {
            const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
            if (!files.length) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) view.dispatch({ selection: { anchor: pos } });
            onFiles(files);
            return true;
          },
        }),
      ],
    }),
  });
  return {
    view,
    setWrap: (on) => view.dispatch({ effects: wrapping.reconfigure(on ? EditorView.lineWrapping : []) }),
    setDoc: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: Math.min(view.state.selection.main.head, text.length) } }),
    destroy: () => view.destroy(),
  };
};

export const minimalChange = (before, after) => {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
};

export const applyTextCommand = (view, command) => {
  const text = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const result = command(text, from, to);
  view.dispatch({ changes: minimalChange(text, result.text), selection: { anchor: result.from, head: result.to }, scrollIntoView: true });
  view.focus();
};
