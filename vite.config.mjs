import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/chainspec/",
  plugins: [
    react(),
    {
      name: "local-csp",
      transformIndexHtml(html, ctx) {
        if (ctx.server) return html;
        return html.replace(
          "<head>",
          `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; img-src 'self' data:; connect-src http: https:; base-uri 'none'; form-action 'none'">`,
        );
      },
    },
  ],
});
