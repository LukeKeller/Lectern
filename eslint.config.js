import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Root ESLint config for the TypeScript packages (shared, api-client, bff).
// apps/web is ignored here: it carries its own Svelte-aware ESLint config.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.svelte-kit/**",
      "**/coverage/**",
      "**/node_modules/**",
      "apps/web/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
