const baseURL = __ENV.BASE_URL || 'https://test-api.k6.io';

export const endpoints = {
  exampleApi: {
    get: baseURL + '/public/crocodiles/1/',
    post: baseURL + '/public/crocodiles/',
    list: baseURL + '/public/crocodiles/',
  },
  // Futuras APIs podem ser adicionadas aqui
  // userApi: {
  //   get: baseURL + '/api/v1/users/',
  //   post: baseURL + '/api/v1/users/',
  // },
  // paymentApi: {
  //   get: baseURL + '/api/v1/payments/',
  //   post: baseURL + '/api/v1/payments/',
  // }
}; 