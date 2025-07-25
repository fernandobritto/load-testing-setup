import { stressOptions as options } from '../config/options/stress.options.js';
import { runGetTest } from '../scenarios/getTest.js';
import { runPostTest } from '../scenarios/postTest.js';

export { options };

export default function () {
  runGetTest();
  runPostTest(true);
} 