import { attachCopyButton } from "./copy.js";
import { trackToc } from "./toc.js";

const start = () => {
  document.querySelectorAll(".prose figure.code").forEach((figure) => attachCopyButton(figure));
  const toc = document.querySelector(".toc");
  if (toc) trackToc(toc);
  const diagrams = [...document.querySelectorAll("[data-mermaid]")];
  if (diagrams.length) {
    import("./mermaid.js").then(({ renderAll, watchScheme }) => {
      renderAll(diagrams);
      watchScheme(diagrams);
    });
  }
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
