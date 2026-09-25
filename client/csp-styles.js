const STYLE_ATTRIBUTE = /(\s)style="/g;

export const deferInlineStyles = (markup) => markup.replace(STYLE_ATTRIBUTE, '$1data-csp-style="');
