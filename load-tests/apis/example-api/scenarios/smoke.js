import { group, sleep } from 'k6';
import { postUser } from '../endpoints/post-user.js';
import { getUser } from '../endpoints/get-user.js';

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '5s', target: 5 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
  },
};

export default function () {
  group('Smoke Test', () => {
    postUser();
    sleep(1);
    getUser();
  });
} 