/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testRegex: 'test/integration/.*\\.integration\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
};
