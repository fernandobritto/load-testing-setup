import http from 'k6/http'
import { check, sleep } from 'k6'

const baseUrl = __ENV.BASE_URL
const token = __ENV.TOKEN

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 0 }
  ]
}

export default function () {
  const params = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }

  const getResponse = http.get(baseUrl, params)
  check(getResponse, {
    'get status is 200': (r) => r.status === 200
  })

  const payload = JSON.stringify({ example: 'data' })
  const postResponse = http.post(baseUrl, payload, params)
  check(postResponse, {
    'post status is 200': (r) => r.status === 200
  })

  sleep(1)
}
