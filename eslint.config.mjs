import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

// Cưỡng chế luật phụ thuộc: Docs/SourceOfTruth/Architecture/architecture-spec.txt mục 2.1, 2.2.
const SAME_MODULE = { module: "{{ from.element.captured.module }}" };
const OTHER_MODULE = { module: "!{{ from.element.captured.module }}" };
const layer = (name) => `${name}/**`;
const moduleFile = (captured, fileInternalPath) => ({
  to: { element: { type: "module", captured, fileInternalPath } },
});

const boundariesConfig = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "import/resolver": { typescript: { alwaysTryTypes: true } },
    "boundaries/elements": [
      { type: "module", pattern: "src/modules/*", capture: ["module"] },
      { type: "kernel", pattern: "src/shared/kernel" },
      { type: "shared-infra", pattern: "src/shared/infrastructure" },
      { type: "app", pattern: "src/app" },
    ],
    "boundaries/files": [
      { category: "composition", pattern: "src/composition-root.ts" },
      // Chỉ gắn header CSP, chỉ được dùng thư viện ngoài (policy external ở dưới).
      { category: "proxy", pattern: "src/proxy.ts" },
    ],
  },
  rules: {
    "boundaries/dependencies": [
      2,
      {
        default: "disallow",
        checkInternals: true,
        checkAllOrigins: true,
        policies: [
          // Thư viện ngoài được phép mặc định; domain bị chặn riêng ở dưới.
          { allow: { to: { module: { origin: ["external", "core"] } } } },
          { from: { element: { type: "kernel" } }, allow: { to: { element: { type: "kernel" } } } },
          {
            from: { element: { type: "shared-infra" } },
            allow: { to: { element: { types: { anyOf: ["kernel", "shared-infra"] } } } },
          },
          // Lớp trong cùng module: phụ thuộc chỉ hướng vào domain.
          {
            from: { element: { type: "module", fileInternalPath: layer("domain") } },
            allow: [
              moduleFile(SAME_MODULE, layer("domain")),
              { to: { element: { type: "kernel" } } },
            ],
          },
          {
            from: { element: { type: "module", fileInternalPath: layer("application") } },
            allow: [
              moduleFile(SAME_MODULE, [layer("domain"), layer("application")]),
              moduleFile(OTHER_MODULE, "index.ts"),
              { to: { element: { type: "kernel" } } },
            ],
          },
          {
            from: { element: { type: "module", fileInternalPath: layer("infrastructure") } },
            allow: [
              moduleFile(SAME_MODULE, [layer("domain"), layer("application"), layer("infrastructure")]),
              moduleFile(OTHER_MODULE, "index.ts"),
              { to: { element: { types: { anyOf: ["kernel", "shared-infra"] } } } },
            ],
          },
          {
            from: { element: { type: "module", fileInternalPath: layer("presentation") } },
            allow: [
              moduleFile(SAME_MODULE, [layer("application"), layer("presentation")]),
              moduleFile(OTHER_MODULE, "index.ts"),
              { to: { element: { type: "kernel" } } },
              { to: { file: { categories: "composition" } } },
            ],
          },
          {
            from: { element: { type: "module", fileInternalPath: "index.ts" } },
            allow: [moduleFile(SAME_MODULE, "**"), { to: { element: { type: "kernel" } } }],
          },
          {
            from: { element: { type: "app" } },
            allow: [
              moduleFile(undefined, "index.ts"),
              { to: { element: { types: { anyOf: ["app", "kernel", "shared-infra"] } } } },
              { to: { file: { categories: "composition" } } },
            ],
          },
          { from: { file: { categories: "composition" } }, allow: { to: { element: { type: "*" } } } },
          // domain là TypeScript thuần: không thư viện ngoài nào.
          {
            from: { element: { type: "module", fileInternalPath: layer("domain") } },
            disallow: { to: { module: { origin: "external" } } },
          },
        ],
      },
    ],
    "boundaries/no-unknown-files": 2,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundariesConfig,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**", ".agents/**", ".codex/**", "Design/**"]),
]);

export default eslintConfig;
