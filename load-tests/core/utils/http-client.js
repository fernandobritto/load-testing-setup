import http from 'k6/http';
import environment from '../config/environment.js';

const defaultHeaders = {
  'Content-Type': 'application/json',
};

function createHttpClient(baseURL) {
  return {
    get(url, params) {
      params = params || {};
      const requestParams = {
        headers: Object.assign({}, defaultHeaders, params.headers || {}),
      };
      Object.assign(requestParams, params);
      return http.get(baseURL + url, requestParams);
    },

    post(url, payload, params) {
      params = params || {};
      const requestParams = {
        headers: Object.assign({}, defaultHeaders, params.headers || {}),
      };
      Object.assign(requestParams, params);
      return http.post(baseURL + url, JSON.stringify(payload), requestParams);
    },
  };
}

export const apiClient = createHttpClient(environment.api.baseURL); 