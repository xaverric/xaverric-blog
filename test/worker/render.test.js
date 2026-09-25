import { describe, expect, it } from "vitest";
import { renderMarkdown, referencedMediaKeys } from "../../src/render/markdown.js";
import { isSafeHref, sanitizeHtml } from "../../src/render/sanitize.js";

const render = (md, options) => renderMarkdown(md, options);
const htmlOf = async (md, options) => (await render(md, options)).html;

describe("headings", () => {
  it("adds unique ids and anchor links", async () => {
    const html = await htmlOf("## Getting started\n\n## Getting started\n\n### Déjà vu `code`");
    expect(html).toContain('<h2 id="getting-started">Getting started<a class="anchor" href="#getting-started" aria-label="Link to this section">#</a></h2>');
    expect(html).toContain('<h2 id="getting-started-2">');
    expect(html).toContain('<h3 id="deja-vu-code">Déjà vu <code>code</code>');
  });

  it("builds a table of contents from h2 and h3 once there are three", async () => {
    expect((await render("## One\n\n## Two")).toc).toEqual([]);
    const { toc } = await render("# Title\n\n## One\n\n### One a\n\n## Two\n\n#### Deep");
    expect(toc).toEqual([
      { id: "one", text: "One", depth: 2 },
      { id: "one-a", text: "One a", depth: 3 },
      { id: "two", text: "Two", depth: 2 },
    ]);
  });
});

describe("code", () => {
  it("highlights known languages on the server", async () => {
    const html = await htmlOf("```js\nconst answer = 42;\n```");
    expect(html).toContain('<figure class="code" data-lang="js"><figcaption class="code__bar"><span class="code__lang">js</span></figcaption>');
    expect(html).toContain('<code class="hljs language-js"><span class="hljs-keyword">const</span>');
    expect(html).toContain('<span class="hljs-number">42</span>');
  });

  it("escapes unknown languages and plain blocks", async () => {
    const html = await htmlOf("```brainfudge\n<b>&\n```\n\n```\nplain\n```");
    expect(html).toContain('data-lang="brainfudge"');
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain('data-lang="text"');
    expect(html).not.toContain("<b>");
  });

  it("passes mermaid through for the client and flags it", async () => {
    const result = await render("```mermaid\nflowchart LR\n  A --> B\n```");
    expect(result.hasMermaid).toBe(true);
    expect(result.html).toContain('<div class="mermaid-block" data-mermaid=""><pre class="mermaid-src"><code>flowchart LR\n  A --&gt; B</code></pre></div>');
    expect((await render("```js\nx\n```")).hasMermaid).toBe(false);
  });
});

describe("math", () => {
  it("renders inline and block math as MathML without inline styles", async () => {
    const html = await htmlOf("Energy $E=mc^2$ here.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n```math\na^2+b^2\n```");
    expect(html).toMatch(/<span class="katex"><math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML">/);
    expect(html).toContain('<div class="math-block"><span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block">');
    expect(html).toContain('<annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation>');
    expect(html).toContain("a^2+b^2");
    expect(html).not.toContain("style=");
  });

  it("leaves prices alone", async () => {
    const html = await htmlOf("It costs $5 and $10 today.");
    expect(html).toContain("It costs $5 and $10 today.");
    expect(html).not.toContain("katex");
  });

  it("shows invalid TeX as code", async () => {
    expect(await htmlOf("$\\frac{1$")).toContain('<code class="math-error"');
  });
});

describe("blocks", () => {
  it("renders tables inside a scroll region with alignment", async () => {
    const html = await htmlOf("| Name | Hours |\n| --- | ---: |\n| Write | 2 |");
    expect(html).toContain('<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table><thead><tr><th scope="col">Name</th><th align="right" scope="col">Hours</th></tr></thead>');
    expect(html).toContain('<td align="right">2</td>');
  });

  it("renders task lists with disabled checkboxes", async () => {
    const html = await htmlOf("- [x] done\n- [ ] todo\n- plain");
    expect(html).toContain('<li class="task"><input checked="" disabled="" type="checkbox"> done</li>');
    expect(html).toContain('<li class="task"><input disabled="" type="checkbox"> todo</li>');
    expect(html).toContain("<li>plain</li>");
  });

  it("renders callouts and plain blockquotes", async () => {
    const html = await htmlOf("> [!WARNING]\n> Mind the **gap**.\n\n> Just a quote.");
    expect(html).toContain('<aside class="callout callout--warning" data-callout="warning" role="note"><p class="callout__title">Warning</p><p>Mind the <strong>gap</strong>.</p>');
    expect(html).toContain("<blockquote>\n<p>Just a quote.</p>\n</blockquote>");
  });

  it("renders footnotes", async () => {
    const html = await htmlOf("Claim.[^1]\n\n[^1]: Source.");
    expect(html).toContain('<a id="footnote-ref-1" href="#footnote-1" data-footnote-ref aria-describedby="footnote-label">1</a>');
    expect(html).toContain('<section class="footnotes" data-footnotes>');
    expect(html).toContain('<li id="footnote-1">');
  });
});

describe("marks", () => {
  it("renders highlight, added and removed with nesting", async () => {
    const html = await htmlOf("A ==key **idea**==, {+new text+} and {-old text-}.");
    expect(html).toContain("<mark>key <strong>idea</strong></mark>");
    expect(html).toContain('<ins class="added">new text</ins>');
    expect(html).toContain('<del class="removed">old text</del>');
  });

  it("keeps ordinary equals signs and braces", async () => {
    const html = await htmlOf("a == b, {+ spaced +} and a=b==c");
    expect(html).not.toContain("<mark>");
    expect(html).not.toContain("<ins>");
  });
});

describe("images", () => {
  const key = "0123456789abcdef0123456789abcdef";
  const media = new Map([[key, { width: 1600, height: 900 }]]);

  it("turns a lone image into a figure with a caption and dimensions", async () => {
    const html = await htmlOf(`![A diagram](/media/${key}.webp "The pipeline")`, { media });
    expect(html).toContain(`<figure class="figure"><img src="/media/${key}.webp" alt="A diagram" width="1600" height="900" loading="lazy" decoding="async"><figcaption>The pipeline</figcaption></figure>`);
  });

  it("uses the alt text as caption and loads the first image eagerly when asked", async () => {
    const html = await htmlOf(`![Only alt](/media/${key}.webp)`, { media, eagerFirstImage: true });
    expect(html).toContain('loading="eager"');
    expect(html).toContain("<figcaption>Only alt</figcaption>");
  });

  it("rewrites external images through the resolver", async () => {
    const html = await htmlOf("Inline ![x](https://example.com/a.png) image", {
      resolveImage: async () => "/img/AAAAAAAAAAAAAAAAAAAAAA/aHR0cHM6Ly9leGFtcGxlLmNvbS9hLnBuZw",
    });
    expect(html).toContain('<img src="/img/AAAAAAAAAAAAAAAAAAAAAA/aHR0cHM6Ly9leGFtcGxlLmNvbS9hLnBuZw" alt="x" loading="lazy" decoding="async">');
    expect(html).not.toContain("example.com");
  });

  it("drops images the proxy refuses and unknown relative paths", async () => {
    const html = await htmlOf("![local](http://localhost/x.png)\n\n![rel](image.jpg)", { resolveImage: async () => "" });
    expect(html).not.toContain("<img");
    expect(html).toContain("local");
    expect(html).toContain("rel");
  });

  it("lists referenced media keys", () => {
    expect(referencedMediaKeys(`![a](/media/${key}.webp) and /media/${key}.png`)).toEqual([key, key]);
  });
});

describe("sanitization", () => {
  it("shows raw HTML as text", async () => {
    const html = await htmlOf('<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\nHi <img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/<script|<iframe|<img/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops javascript: and data: links but keeps the text", async () => {
    const html = await htmlOf("[click](javascript:alert(1)) [data](data:text/html,x) [ok](https://example.com) [rel](/about) [mail](mailto:a@b.cz)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="data:');
    expect(html).toContain('<a href="https://example.com">ok</a>');
    expect(html).toContain('<a href="/about">rel</a>');
    expect(html).toContain('<a href="mailto:a@b.cz">mail</a>');
    expect(html).toContain("click");
  });

  it("strips disallowed tags, attributes and comments from HTML", async () => {
    const dirty =
      '<p onclick="x()" style="color:red" class="ok">a<script>bad()</script><iframe></iframe><!-- c --><a href="javascript:x">l</a><a href="//evil.example">p</a><img src="https://evil.example/x.png"><custom>kept</custom><svg><script>1</script></svg><math><mi href="x">x</mi></math></p>';
    const clean = await sanitizeHtml(dirty);
    expect(clean).toBe('<p class="ok">a<a>l</a><a>p</a>kept<math><mi>x</mi></math></p>');
  });

  it("validates hrefs", () => {
    expect(isSafeHref("https://example.com/a?b#c")).toBe(true);
    expect(isSafeHref("#top")).toBe(true);
    expect(isSafeHref(" javascript:alert(1)")).toBe(false);
    expect(isSafeHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeHref("//evil.example")).toBe(false);
    expect(isSafeHref("vbscript:x")).toBe(false);
  });
});

describe("metadata", () => {
  it("estimates reading time and a summary", async () => {
    const words = Array.from({ length: 660 }, (_, i) => `word${i}`).join(" ");
    const result = await render(`# T\n\n${words}\n\n\`\`\`js\n${"x ".repeat(2000)}\n\`\`\``);
    expect(result.readingMinutes).toBe(3);
    expect(result.summary.length).toBeLessThanOrEqual(200);
    expect(result.summary.endsWith("…")).toBe(true);
  });
});
