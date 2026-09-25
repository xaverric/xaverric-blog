const RESET_MS = 2000;

export const codeText = (figure) => figure.querySelector("pre code")?.textContent ?? "";

export const attachCopyButton = (figure, clipboard = navigator.clipboard) => {
  const bar = figure.querySelector(".code__bar");
  if (!bar || bar.querySelector(".copy")) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.textContent = "Copy";
  button.setAttribute("aria-label", `Copy ${figure.dataset.lang ?? "code"} to clipboard`);
  let timer = null;
  const settle = (state, label) => {
    button.dataset.state = state;
    button.textContent = label;
    clearTimeout(timer);
    timer = setTimeout(() => {
      delete button.dataset.state;
      button.textContent = "Copy";
    }, RESET_MS);
  };
  button.addEventListener("click", async () => {
    try {
      await clipboard.writeText(codeText(figure));
      settle("copied", "Copied");
    } catch {
      settle("failed", "Failed");
    }
  });
  bar.append(button);
  return button;
};
