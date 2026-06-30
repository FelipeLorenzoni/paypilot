/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.int.spec.ts"],
  transform: {
    "^.+\\.(t|j)s$": ["@swc/jest"],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // Testcontainers needs time to start an ephemeral PostgreSQL.
  testTimeout: 120000,
  // Run integration suites serially — one ephemeral PostgreSQL container at a
  // time (parallel containers contend for Docker resources/ports).
  maxWorkers: 1,
};
