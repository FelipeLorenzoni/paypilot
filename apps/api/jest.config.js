/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\.(t|j)s$": ["@swc/jest"],
  },
  // Generated (CJS) Prisma client uses explicit ".js" import extensions; in
  // tests the sources are uncompiled ".ts", so strip the extension to resolve.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
