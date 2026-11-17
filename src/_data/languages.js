import { readFileSync } from "node:fs";
import site from "./site.js";

// One entry per published language, in menu order.
// `fallback` is tried in order for every text a language does not define itself;
// English is always the last resort.
const LANGUAGES = [
  { code: "en", flag: "🇬🇧", name: "English" },
  { code: "de", flag: "🇩🇪", name: "Deutsch" },
];

const DEFAULT = "en";

const load = (code) =>
  JSON.parse(readFileSync(new URL(`./i18n/${code}.json`, import.meta.url), "utf8"));

// Merges b into a; sections like `quiz` are merged text by text.
function merge(a, b) {
  const result = { ...a };
  for (const [key, value] of Object.entries(b)) {
    result[key] = value && typeof value === "object" ? merge(a[key] ?? {}, value) : value;
  }
  return result;
}

// English <- fallbacks <- own texts.
function texts(lang) {
  const chain = [DEFAULT, ...(lang.fallback ?? []), lang.code].filter(
    (code, i, all) => all.indexOf(code) === i,
  );
  return chain.map(load).reduce(merge);
}

export default LANGUAGES.map((lang) => {
  const path = lang.code === DEFAULT ? "/" : `/${lang.code}/`;
  return {
    dir: "ltr",
    ...lang,
    // BCP 47 tag for <html lang> and hreflang, e.g. pt-BR
    htmlLang: lang.code.replace(/-([a-z]{2})$/, (_, region) => `-${region.toUpperCase()}`),
    path,
    url: site.origin + site.pathPrefix + path.slice(1),
    t: texts(lang),
    // The rules without nines: the same texts, with those from `noNines` on top.
    tNoNines: (({ noNines, ...t }) => merge(t, noNines ?? {}))(texts(lang)),
  };
});
