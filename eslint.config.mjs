import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import { defineConfig, globalIgnores } from "eslint/config";
import { fileURLToPath } from "node:url";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
	{
		plugins: { js, perfectionist },
		extends: ["js/recommended", eslintConfigPrettier],
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			"no-undef": "off",
			"perfectionist/sort-array-includes": "error",
			"perfectionist/sort-imports": "error",
			"perfectionist/sort-named-imports": "error",
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error"],
		},
	},
	// Override default ignores of eslint-config-next.
	globalIgnores([
		// Default ignores of eslint-config-next:
		".next/**",
		"out/**",
		"build/**",
		"next-env.d.ts",
	]),
	includeIgnoreFile(gitignorePath, "Imported .gitignore patterns"),
]);

export default eslintConfig;
