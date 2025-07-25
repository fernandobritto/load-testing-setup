import { check } from 'k6';
import { apiClient } from '../../../core/utils/http-client.js';
import { createUserPayload } from '../data/factory.js';

export function postUser() {
  const payload = createUserPayload();
  const response = apiClient.post('/public/crocodiles/', payload);

  check(response, {
    'POST /public/crocodiles/ - status is 201': (r) => r.status === 201,
  });

  return response;
} 