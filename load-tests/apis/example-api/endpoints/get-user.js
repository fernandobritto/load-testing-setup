import { check } from 'k6';
import { apiClient } from '../../../core/utils/http-client.js';

export function getUser() {
  const response = apiClient.get('/public/crocodiles/1/');

  check(response, {
    'GET /public/crocodiles/1/ - status is 200': (r) => r.status === 200,
  });

  return response;
} 