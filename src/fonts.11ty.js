// Builds /assets/fonts.css from the @font-face rules shipped with @fontsource,
// keeping only the subsets listed in src/_data/fonts.js. The font files themselves
// are copied to /assets/fonts/ by eleventy.config.js.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const data = {
  permalink: "/assets/fonts.css",
  eleventyExcludeFromCollections: true,
};

export function render({ fonts }) {
  const rules = [];
  for (const { pkg, weights, subsets } of fonts) {
    for (const weight of weights) {
      const css = readFileSync(require.resolve(`@fontsource/${pkg}/${weight}.css`), "utf8");
      for (const [, name, rule] of css.matchAll(/\/\* (\S+) \*\/\s*(@font-face \{[^}]*\})/g)) {
        const subset = name.slice(pkg.length + 1, -`-${weight}-normal`.length);
        if (!subsets.includes(subset)) continue;
        // woff2 only (every current browser), path relative to this stylesheet
        rules.push(rule.replace(/src: [^;]*;/, `src: url(fonts/${name}.woff2) format("woff2");`));
      }
    }
  }
  return rules.join("\n\n") + "\n";
}
