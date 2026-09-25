import { Editor, Extension, InputRule } from "@tiptap/core";
import { editorExtensions } from "./extensions.js";

const imageFiles = (list) => [...(list ?? [])].filter((file) => file.type.startsWith("image/"));

const MathInputRules = Extension.create({
  name: "mathInputRules",
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|[^$\\])\$([^$\s][^$]*)\$$/,
        handler: ({ state, range, match }) => {
          if (/\s$/.test(match[1])) return null;
          const start = range.from + match[0].indexOf("$");
          const node = state.schema.nodes.mathInline?.create({ tex: match[1] });
          if (node) state.tr.replaceWith(start, range.to, node);
        },
      }),
    ];
  },
});

const Shortcuts = (keys) =>
  Extension.create({
    name: "blogShortcuts",
    priority: 1000,
    addKeyboardShortcuts: () => keys,
  });

export const createRichEditor = ({ element, markdown, onChange, onSelection, onFiles, keys }) =>
  new Editor({
    element,
    injectCSS: false,
    extensions: [...editorExtensions(), MathInputRules, Shortcuts(keys)],
    content: markdown,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "surface__doc prose", "aria-label": "Post body", spellcheck: "true" },
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        onFiles(files, view.state.selection.from);
        return true;
      },
      handleDrop: (view, event, slice, moved) => {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        onFiles(files, at?.pos ?? view.state.selection.from);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor),
    onSelectionUpdate: ({ editor }) => onSelection(editor),
    onTransaction: ({ editor }) => onSelection(editor),
  });

export const currentBlock = (editor) => {
  for (let level = 1; level <= 6; level++) if (editor.isActive("heading", { level })) return `h${level}`;
  return "p";
};
