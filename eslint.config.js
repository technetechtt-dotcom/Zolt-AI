export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "sbom.json"]
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error"
    }
  }
];
