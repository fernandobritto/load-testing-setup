export interface Concept {
  id: string
  question: string
  answer: string
}

/**
 * Contextual documentation shown across the app ("What is a Threshold?" …).
 * Grounded in the Grafana k6 docs and common performance-engineering practice.
 */
export const CONCEPTS: Concept[] = [
  {
    id: 'virtual-user',
    question: 'What is a Virtual User?',
    answer:
      'A Virtual User (VU) is an independent execution loop that runs your test script over and over, in parallel with all other VUs. Each VU has its own JavaScript runtime, cookie jar and connections — like a separate simulated client. VUs are a concurrency measure, not a throughput measure: the requests per second that N VUs generate depends on response times and think time in your script.'
  },
  {
    id: 'scenario',
    question: 'What is a Scenario?',
    answer:
      'A scenario is an independent workload schedule inside one test: which function runs, with which executor, how many VUs or what arrival rate, and for how long. Multiple scenarios can run in sequence (using startTime) or in parallel — e.g. a browsing workload alongside a checkout workload — each with its own tags so results stay separable.'
  },
  {
    id: 'suite-of-scenarios',
    question: 'Why does one project hold several scenarios?',
    answer:
      'Because a single test answers a single question. The same user journey has to be measured as a smoke test (does it work at all?), a load test (does it meet its SLOs?), a stress test (how does it degrade?), a soak (does it leak?) — each with its own ramp and its own thresholds. Keeping them in one suite means one journey to maintain instead of four copies: k6 lets several scenarios share the same exported function, so the requests are declared once and only the workload differs.'
  },
  {
    id: 'one-at-a-time',
    question: 'Should scenarios run together or one at a time?',
    answer:
      'Both are valid, and the difference matters. Scenarios that are *alternatives* over one journey (smoke or load or soak) must run one per invocation — starting a four-hour soak alongside a one-minute smoke test measures neither, and the mixed traffic makes both sets of numbers meaningless. Scenarios that are *parts of one workload* (browsing plus checkout plus a background writer) belong in the same run, sequenced with startTime. k6 has no CLI flag for picking a scenario, so the documented approach is to build the scenarios object from an environment variable — which is what the generated script does: k6 run -e SCENARIO=stress suite.js.'
  },
  {
    id: 'executor',
    question: 'What is an Executor?',
    answer:
      'The executor is the scheduling algorithm of a scenario — it decides how VUs and iterations are started over time. VU-based executors (constant-vus, ramping-vus) model a number of concurrent users; arrival-rate executors (constant-arrival-rate, ramping-arrival-rate) model throughput in iterations per second regardless of how slow the target responds; iteration-based executors run a fixed amount of work and stop.'
  },
  {
    id: 'threshold',
    question: 'What is a Threshold?',
    answer:
      'A threshold is a pass/fail criterion evaluated against a metric, e.g. http_req_duration: p(95)<500. If any threshold fails, k6 exits with a non-zero code — this is what turns a load test into an automated quality gate in CI/CD. Thresholds can also abort the test early (abortOnFail) to stop hammering a system that has already failed.'
  },
  {
    id: 'check',
    question: 'What is a Check?',
    answer:
      'A check is a functional assertion on a response — status code, body content, JSON fields, headers. Unlike thresholds, failing checks never stop the test; they are recorded in the checks rate metric. Best practice: always pair checks with a threshold on the checks metric (e.g. rate>0.99), otherwise a test with failing checks still passes.'
  },
  {
    id: 'think-time',
    question: 'What is Think Time?',
    answer:
      'Think time is the pause a real user takes between actions — reading a page, filling a form. Adding sleep() between requests makes VU-based workloads realistic: without it, 50 VUs can generate the traffic of thousands of real users and you end up testing a scenario that will never occur. Randomize think time (e.g. 1–4s) to avoid artificial synchronization of VUs.'
  },
  {
    id: 'ramping-vus-when',
    question: 'When should I use ramping-vus?',
    answer:
      'Use ramping-vus when your load model is “how many concurrent users” and you want the count to change over time — the classic ramp-up → plateau → ramp-down of load, stress, spike and soak tests. Prefer an arrival-rate executor instead when your question is about throughput (requests per second): with ramping-vus, throughput silently drops as the system slows down, which can hide the very degradation you are looking for.'
  },
  {
    id: 'stress-vs-spike',
    question: 'Stress vs Spike testing — what is the difference?',
    answer:
      'Both push the system beyond normal load; the difference is the shape of the curve. A stress test ramps up gradually and holds, answering “how does the system degrade as load grows past the expected peak?”. A spike test jumps to extreme load almost instantly and drops just as fast, answering “does the system survive a sudden surge (flash sale, viral moment) and recover afterwards?”. Gradual ramps give autoscaling time to react — spikes deliberately do not.'
  },
  {
    id: 'arrival-rate',
    question: 'Why do arrival-rate executors exist?',
    answer:
      'With VU-based executors, a slow system makes each iteration take longer, so fewer requests are sent — the load generator “coordinates” with the system under test and under-reports the problem (coordinated omission). Arrival-rate executors start iterations on a fixed schedule regardless of response times, keeping throughput constant while latency degrades — the realistic behavior of real-world traffic, which does not slow down just because your servers did.'
  },
  {
    id: 'setup-teardown',
    question: 'What are setup() and teardown()?',
    answer:
      'setup() runs once before the test starts (e.g. obtain an auth token, seed data) and its return value is passed to every iteration and to teardown(). teardown() runs once after the test ends, for cleanup. Both run in their own VU and their duration does not pollute your main metrics.'
  },
  {
    id: 'shared-array',
    question: 'What is a SharedArray?',
    answer:
      'A SharedArray is a read-only array shared across all VUs in a single memory copy. Without it, parameterization data (users, products) is duplicated per VU — 10k rows × 500 VUs can exhaust the load generator memory. Use it for any test data with more than a handful of rows.'
  },
  {
    id: 'env-vars',
    question: 'How do environment variables work in k6?',
    answer:
      "Values passed with k6 run -e NAME=value are exposed on the __ENV object. They keep environment-specific configuration (base URLs, credentials) out of the script, making the same script runnable against dev, staging and production. Provide defaults in the script (__ENV.BASE_URL || 'https://staging.example.com') so it runs without flags too."
  }
]

export function conceptById(id: string): Concept | undefined {
  return CONCEPTS.find((c) => c.id === id)
}
