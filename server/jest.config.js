/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  clearMocks: true,
  collectCoverage: true,
  // Coverage is enforced at 100% over the pure-logic modules under test. Add modules
  // here as they are extracted/unit-tested so the gate stays meaningful and achievable.
  collectCoverageFrom: ["src/safe-shell.ts", "src/demo.ts"],
  coverageThreshold: {
    global: { branches: 100, functions: 100, lines: 100, statements: 100 },
  },
};
