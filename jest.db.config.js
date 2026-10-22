// Database integration and security tests. Require a PostgreSQL 15+ server; see docs/testing-checklist.md.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['<rootDir>/tests/security/**/*.test.ts', '<rootDir>/tests/integration/db/**/*.test.ts'],
  transform: { '^.+\\.[jt]sx?$': 'babel-jest' },
  globalSetup: '<rootDir>/tests/db/global-setup.js',
  testTimeout: 30000,
};
