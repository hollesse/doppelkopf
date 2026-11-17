// Loaded on every page. Progressive enhancement: everything works without it.
// Remembers the chosen language, closes the language menu on outside click or Escape,
// and installs the service worker that makes the site work offline.

// ---------- Offline ----------

// sw.js sits next to the pages, one folder above this script.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {});
}

// ---------- Language menu ----------

const menu = document.querySelector(".langmenu");

menu.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-lang]");
  if (!link) return;
  try {
    localStorage.setItem("lang", link.dataset.lang);
  } catch {}
});

// Close the menu on outside click or Escape.
document.addEventListener("click", (event) => {
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.open) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});
