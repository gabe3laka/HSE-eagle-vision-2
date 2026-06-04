import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      // Auto-managed Supabase integration files — generated/scaffolded, never
      // hand-edited, so they are excluded from linting (and from --fix).
      "src/integrations/supabase/client.ts",
      "src/integrations/supabase/client.server.ts",
      "src/integrations/supabase/auth-middleware.ts",
      "src/integrations/supabase/auth-attacher.ts",
      "src/integrations/supabase/types.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // shadcn/ui modules intentionally export helpers/variants alongside their
    // components; the Fast Refresh hint isn't meaningful for this project.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // db.ts deliberately bridges typed-table access with `any` while the
    // auto-generated Database types catch up to a fresh migration.
    files: ["src/integrations/supabase/db.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // router-shim bridges react-router-dom-style call sites onto TanStack Router:
    // its @ts-ignore lines are intentional ("Link accepts plain strings at runtime")
    // and it re-exports hooks alongside components. Neither is meaningful to flag.
    files: ["src/lib/router-shim.tsx"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  eslintPluginPrettier,
);
