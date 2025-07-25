/*
 * K6 Performance Testing Framework
 * 
 * Usage:
 *   k6 run load-tests/tests/smoke.test.js
 *   k6 run load-tests/tests/load.test.js  
 *   k6 run load-tests/tests/stress.test.js
 * 
 * With custom environment:
 *   k6 run --env BASE_URL=https://your-api.com load-tests/tests/smoke.test.js
 * 
 * Architecture:
 *   - config/: Configuration files (endpoints, payloads, options)
 *   - scenarios/: Reusable test scenarios (GET, POST)
 *   - tests/: Complete test suites combining scenarios with load profiles
 * 
 * Adding new APIs:
 *   1. Add endpoints to config/endpoints.js
 *   2. Add payloads to config/payloads.js
 *   3. Create new scenarios in scenarios/
 *   4. Compose new tests in tests/
 */

export default function() {
  console.log('Use k6 run with specific test files instead of this runner');
} 