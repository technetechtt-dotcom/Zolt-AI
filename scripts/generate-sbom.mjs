import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", name: pkg.name, version: pkg.version }
  },
  components: Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(([name, version]) => ({
    type: "library",
    name,
    version: String(version).replace(/^[^0-9]*/, "")
  }))
};

writeFileSync("sbom.json", JSON.stringify(sbom, null, 2));
console.log("Wrote sbom.json");
