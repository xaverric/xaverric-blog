import { svg } from "./dom.js";

const PATHS = {
  bold: "M6 4h5a3 3 0 0 1 0 6H6z M6 10h6a3 3 0 0 1 0 6H6z",
  italic: "M9 4h6 M5 16h6 M12 4 8 16",
  strike: "M4 10h12 M13.5 6.5C13 5 11.7 4 10 4 7.8 4 6.5 5.2 6.5 6.8c0 1.2.8 2 2 2.4 M7 13.5c.5 1.5 1.8 2.5 3.2 2.5 2.3 0 3.6-1.2 3.6-2.8",
  code: "M7 6 3 10l4 4 M13 6l4 4-4 4",
  highlight: "M5 13.5 12.5 6l2.5 2.5L7.5 16H5z M11 7.5l2.5 2.5 M3 18.5h14",
  added: "M3 3h14v14H3z M10 6.5v7 M6.5 10h7",
  removed: "M3 3h14v14H3z M6.5 10h7",
  bullet: "M8 5h9 M8 10h9 M8 15h9 M3.5 5h1 M3.5 10h1 M3.5 15h1",
  ordered: "M8 5h9 M8 10h9 M8 15h9 M3 3.5h1.5V7 M2.8 7h3.4 M3 12.5h2.5v1.7H3V16h2.6",
  task: "M3 4h4v4H3z M3 12h4v4H3z M10 6h7 M10 14h7",
  quote: "M4 6h5v4H6v3H4z M11 6h5v4h-3v3h-2z",
  table: "M3 4h14v12H3z M3 8h14 M3 12h14 M8 4v12 M12.5 4v12",
  image: "M3 4h14v12H3z M3 13.5l4-4 3 3 2-2 5 5 M12.5 7.5h.5",
  link: "M8.5 11.5l3-3 M7.5 9 5.3 11.2a2.5 2.5 0 0 0 3.5 3.5l2.2-2.2 M12.5 11l2.2-2.2a2.5 2.5 0 0 0-3.5-3.5L9 7.5",
  codeblock: "M3 3h14v14H3z M7.5 8 5.5 10l2 2 M12.5 8l2 2-2 2 M11 7l-2 6",
  mermaid: "M3 3h5v4H3z M12 13h5v4h-5z M5.5 7v3.5h9V13",
  math: "M15 4H5l5 6-5 6h10",
  callout: "M3 4h14v10H9l-4 3v-3H3z M10 7v3 M10 12h.01",
  rule: "M3 10h14",
  wrap: "M3 5h14 M3 10h11a3 3 0 0 1 0 6h-3 M12.5 14.5 11 16l1.5 1.5 M3 15h5",
  undo: "M7 5 3 9l4 4 M3 9h9a4.5 4.5 0 0 1 0 9h-2",
  redo: "M13 5l4 4-4 4 M17 9H8a4.5 4.5 0 0 0 0 9h2",
  eye: "M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  trash: "M4 6h12 M8 6V4h4v2 M5.5 6l1 10h7l1-10",
  upload: "M10 13V4 M6 8l4-4 4 4 M4 16h12",
  chevron: "M6 8l4 4 4-4",
  back: "M8 5 3 10l5 5 M3 10h14",
  external: "M11 3h6v6 M17 3l-8 8 M14 12v5H3V6h5",
  plus: "M10 4v12 M4 10h12",
  close: "M5 5l10 10 M15 5 5 15",
};

export const icon = (name, { label } = {}) =>
  svg(
    "svg",
    { class: `icon icon--${name}`, viewBox: "0 0 20 20", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "square", "stroke-linejoin": "miter", "aria-hidden": label ? null : "true", role: label ? "img" : null, "aria-label": label ?? null, focusable: "false" },
    svg("path", { d: PATHS[name] ?? "" }),
  );
