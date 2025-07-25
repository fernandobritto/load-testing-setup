import http from 'k6/http';
import { check } from 'k6';
import { endpoints } from '../config/endpoints.js';

export function runGetTest() {
  const res = http.get(endpoints.exampleApi.get);

  check(res, {
    'GET status is 200': (r) => r.status === 200,
    'GET response time < 500ms': (r) => r.timings.duration < 500,
  });

  return res;
} 