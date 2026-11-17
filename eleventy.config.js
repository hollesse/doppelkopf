import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { HtmlBasePlugin } from "@11ty/eleventy";
import site from "./src/_data/site.js";
import fonts from "./src/_data/fonts.js";

export default function (eleventyConfig) {
  // Prefixes root-relative links (/de/, /assets/…) with site.pathPrefix.
  eleventyConfig.addPlugin(HtmlBasePlugin);
  eleventyConfig.addPassthroughCopy("src/assets");

  eleventyConfig.addPassthroughCopy({ "src/manifest.webmanifest": "manifest.webmanifest" });

  // QR code library (MIT) → /assets/qrcode.js
  eleventyConfig.addPassthroughCopy({ "node_modules/qrcode-generator/qrcode.js": "assets/qrcode.js" });

  // Font files listed in src/_data/fonts.js → /assets/fonts/
  for (const { pkg, weights, subsets } of fonts) {
    for (const subset of subsets) {
      for (const weight of weights) {
        const file = `${pkg}-${subset}-${weight}-normal.woff2`;
        eleventyConfig.addPassthroughCopy({ [`node_modules/@fontsource/${pkg}/files/${file}`]: `assets/fonts/${file}` });
      }
    }
  }

  // After the build: write the service worker with the list of all files and a
  // hash over their contents, so every deploy with changes gets a fresh cache.
  eleventyConfig.on("eleventy.after", ({ dir }) => {
    const files = readdirSync(dir.output, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== "sw.js")
      .map((entry) => relative(dir.output, join(entry.parentPath, entry.name)).split("\\").join("/"))
      .sort();
    const hash = createHash("sha256");
    for (const file of files) hash.update(file).update(readFileSync(join(dir.output, file)));
    // Pages are cached under their folder URL ("de/"), not ".../index.html".
    const urls = files.map((file) => file.replace(/(^|\/)index\.html$/, "$1") || "./");
    const sw = readFileSync("src/sw.js", "utf8")
      .replace("__VERSION__", hash.digest("hex").slice(0, 12))
      .replace("__FILES__", JSON.stringify(urls, null, 2));
    writeFileSync(join(dir.output, "sw.js"), sw);
  });
}

export const config = {
  dir: { input: "src", output: "_site" },
  pathPrefix: site.pathPrefix,
};
