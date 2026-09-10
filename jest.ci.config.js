/**
 * CI test config: the base config minus the suites that are already broken in
 * pristine upstream `mickey`.
 *
 * Upstream historically shipped a red test suite at f1f022a. The fork now
 * maintains every remaining test here, including the booking and API suites,
 * so a green CI result represents the full Jest suite.
 */
const base = require('./jest.config');

module.exports = {
  ...base,
  testPathIgnorePatterns: [
    '/node_modules/',
  ],
};
