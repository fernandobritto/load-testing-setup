import http from 'k6/http';
import { check } from 'k6';
import { endpoints } from '../config/endpoints.js';
import { payloads } from '../config/payloads.js';

export function runPostTest(useDynamicData = false) {
  const headers = { 'Content-Type': 'application/json' };
  const payload = useDynamicData ? 
    payloads.generateDynamicPostData() : 
    payloads.validPostData;
  
  const res = http.post(
    endpoints.exampleApi.post, 
    JSON.stringify(payload), 
    { headers }
  );

  check(res, {
    'POST status is 201 or 200': (r) => r.status === 201 || r.status === 200,
    'POST response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  return res;
} 