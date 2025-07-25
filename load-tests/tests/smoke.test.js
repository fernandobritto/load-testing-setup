import { smokeOptions as options } from '../config/options/smoke.options.js';
import { runGetTest } from '../scenarios/getTest.js';
import { runPostTest } from '../scenarios/postTest.js';

export { options };

export default function () {
  runGetTest();
  runPostTest();
} 