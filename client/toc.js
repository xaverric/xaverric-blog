export const activeHeading = (entries, current) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
  return visible[0]?.target.id ?? current;
};

export const trackToc = (toc) => {
  const links = new Map([...toc.querySelectorAll("a[href^='#']")].map((link) => [decodeURIComponent(link.hash.slice(1)), link]));
  const headings = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  if (!headings.length || !("IntersectionObserver" in window)) return;
  let current = null;
  const observer = new IntersectionObserver(
    (entries) => {
      const next = activeHeading(entries, current);
      if (next === current) return;
      links.get(current)?.removeAttribute("aria-current");
      links.get(next)?.setAttribute("aria-current", "true");
      current = next;
    },
    { rootMargin: "0px 0px -70% 0px" },
  );
  headings.forEach((heading) => observer.observe(heading));
};
