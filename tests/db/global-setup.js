const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set. Point it at a disposable PostgreSQL database (it is dropped and recreated).');
  }
  execFileSync(path.join(__dirname, '../../scripts/db-test-reset.sh'), { stdio: 'inherit', cwd: path.join(__dirname, '../..') });
};
