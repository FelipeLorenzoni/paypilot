const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");
const globals = require("globals");

module.exports = tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "apps/api/src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS config/tooling files (eslint.config.js, jest.config.js, ...)
    files: ["**/*.{js,cjs}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // The shared package MUST stay framework-agnostic (see design).
    files: ["packages/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@nestjs",
                "@nestjs/*",
                "next",
                "next/*",
                "@prisma/*",
                "prisma",
                "@paypilot/api",
                "@paypilot/web",
              ],
              message:
                "packages/shared must stay framework-agnostic (no NestJS/Next.js/Prisma/app imports).",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
