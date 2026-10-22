try {
  const t = localStorage.getItem("chainspec-theme");
  document.documentElement.dataset.theme =
    t === "dark" ||
    (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
} catch {}
