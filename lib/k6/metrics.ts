import type { MetricType, ThresholdAggregation } from '@/lib/dsl/types'

export interface MetricEducation {
  description: string
  measures: string
  whyItMatters: string
  slaRecommendation: string
  sloRecommendation: string
  bestPractices: string
  pitfalls: string
  interpretation: string
}

export interface BuiltinMetricMeta {
  name: string
  type: MetricType
  unit: 'ms' | 'count' | 'rate' | 'bytes' | 'vus'
  education: MetricEducation
}

/** Aggregations that are valid in threshold expressions per metric type */
export const AGGREGATIONS_BY_TYPE: Record<MetricType, ThresholdAggregation[]> = {
  trend: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  rate: ['rate'],
  counter: ['count', 'rate'],
  gauge: ['value']
}

/**
 * Built-in k6 metrics with educational content.
 * https://grafana.com/docs/k6/latest/using-k6/metrics/reference/
 */
export const BUILTIN_METRICS: BuiltinMetricMeta[] = [
  {
    name: 'http_req_duration',
    type: 'trend',
    unit: 'ms',
    education: {
      description:
        'Total time of an HTTP request: sending + waiting (TTFB) + receiving. DNS lookup and connection time are excluded.',
      measures: 'End-to-end server processing latency as experienced by the client, per request.',
      whyItMatters:
        'This is the closest built-in proxy for user-perceived API latency and the most common SLO metric in the industry.',
      slaRecommendation: 'Public APIs commonly commit to p(95) < 500ms and p(99) < 1s for read endpoints.',
      sloRecommendation:
        'Set p(95) thresholds per endpoint class: reads < 300–500ms, writes < 800ms–1s. Track p(99) separately for tail latency.',
      bestPractices:
        'Always threshold on percentiles, never on averages. Use tagged sub-thresholds (e.g. { expected_response:true }) to exclude error responses that return fast.',
      pitfalls:
        'Averages hide the tail — a 200ms average can coexist with a 5s p(99). Fast error responses (e.g. instant 500s) can make this metric look better while the system burns.',
      interpretation:
        'Rising p(95)/p(99) while the request rate is stable usually indicates resource saturation (CPU, DB connections, GC pauses). Compare against http_req_waiting to isolate server time.'
    }
  },
  {
    name: 'http_req_failed',
    type: 'rate',
    unit: 'rate',
    education: {
      description:
        'The rate of failed HTTP requests. By default, statuses outside 200–399 count as failures.',
      measures:
        'The fraction of requests (0.0–1.0) that returned an error according to the configured responseCallback.',
      whyItMatters: 'Availability is the first pillar of every SLA. Latency is irrelevant if requests fail.',
      slaRecommendation: 'Typical availability SLAs demand error rates below 0.1%–1% (rate < 0.001 – 0.01).',
      sloRecommendation:
        'rate < 0.01 is a common starting SLO for load tests; tighten to rate < 0.001 for critical payment/auth flows.',
      bestPractices:
        'Pair with checks: http_req_failed only sees HTTP status classes, while checks validate business correctness of the payload.',
      pitfalls:
        'A 200 response with a wrong body is NOT a failure here. Redirect-heavy flows can mask errors if the final hop succeeds.',
      interpretation:
        'Error rate rising together with load identifies your breakpoint. Sudden error cliffs (0% → 40%) usually mean a saturated pool — threads, DB connections, or file descriptors.'
    }
  },
  {
    name: 'http_reqs',
    type: 'counter',
    unit: 'count',
    education: {
      description: 'Total number of HTTP requests k6 generated.',
      measures:
        'Raw request volume, and — through its rate — the achieved throughput in requests per second.',
      whyItMatters:
        'Throughput is the denominator of every capacity question: “how many RPS can we serve within SLO?”',
      slaRecommendation:
        'Capacity SLAs are usually expressed as “sustain N RPS at p(95) < X ms with error rate < Y%”.',
      sloRecommendation:
        'Threshold with count or rate when the test must prove a minimum achieved throughput, e.g. rate > 100.',
      bestPractices:
        'Use arrival-rate executors when throughput is the variable under test — VU-based executors let throughput sag as latency grows (coordinated omission).',
      pitfalls:
        'High RPS with high error rates is meaningless; always read throughput together with http_req_failed and latency.',
      interpretation:
        'If achieved RPS plateaus while VUs keep rising, the system is saturated — additional load only queues.'
    }
  },
  {
    name: 'iteration_duration',
    type: 'trend',
    unit: 'ms',
    education: {
      description:
        'Time to complete one full iteration of the default function, including sleeps and setup/teardown iterations.',
      measures:
        'End-to-end duration of an entire user journey (all requests, think time and logic in the iteration).',
      whyItMatters:
        'Represents the full user transaction time — closer to a business KPI (e.g. “checkout takes < 8s”) than any single request.',
      slaRecommendation: 'Business-flow SLAs, e.g. “95% of checkouts complete within 10 seconds”.',
      sloRecommendation:
        'Set p(95) on the full journey if stakeholders think in transactions, not endpoints.',
      bestPractices:
        'Remember that sleep() time is included — subtract configured think time when reasoning about system latency.',
      pitfalls:
        'Comparing iteration_duration across tests with different sleep configurations is comparing apples to oranges.',
      interpretation:
        'Rising iteration duration with constant think time means the HTTP portion is slowing down; use group_duration or per-request metrics to find which step.'
    }
  },
  {
    name: 'iterations',
    type: 'counter',
    unit: 'count',
    education: {
      description: 'Total number of completed iterations of the default function.',
      measures: 'How many complete user journeys were executed during the test.',
      whyItMatters:
        'For iteration-based executors this is your progress metric; for business reporting it translates to “simulated user sessions”.',
      slaRecommendation: 'Rarely part of SLAs directly; used to size test coverage.',
      sloRecommendation:
        'Threshold count > N to guarantee the test exercised a minimum number of journeys before passing.',
      bestPractices:
        'In arrival-rate executors, compare started vs completed iterations to detect dropped iterations (insufficient VUs).',
      pitfalls:
        'A test can pass latency thresholds while running far fewer iterations than intended — always sanity-check volume.',
      interpretation:
        'dropped_iterations > 0 alongside low iterations means preAllocatedVUs/maxVUs are too low for the requested rate.'
    }
  },
  {
    name: 'vus',
    type: 'gauge',
    unit: 'vus',
    education: {
      description: 'Current number of active virtual users.',
      measures: 'Instantaneous concurrency at each moment of the test.',
      whyItMatters:
        'Concurrency is the independent variable of VU-based load tests — every latency/error observation is read against it.',
      slaRecommendation: 'Not an SLA metric; it describes the load you applied, not the system behavior.',
      sloRecommendation: 'Use value thresholds only for sanity assertions (e.g. value <= expected max).',
      bestPractices:
        'Overlay vus with latency/error series when analyzing results to see exactly where degradation began.',
      pitfalls:
        'VUs are not users-per-second: one VU loops continuously, so 100 VUs can generate wildly different RPS depending on response times and sleeps.',
      interpretation:
        'The VU level at which p(95) crosses your SLO is your effective capacity in concurrent users.'
    }
  },
  {
    name: 'vus_max',
    type: 'gauge',
    unit: 'vus',
    education: {
      description: 'Maximum number of VUs allocated for the test run.',
      measures: 'The pre-allocated VU pool size — the ceiling of possible concurrency.',
      whyItMatters:
        'VU initialization costs memory and time; the pool size determines resource needs of the load generator itself.',
      slaRecommendation: 'Not an SLA metric.',
      sloRecommendation: 'Not typically thresholded.',
      bestPractices:
        'For arrival-rate executors, watch vus vs vus_max: if they converge, the pool is about to be exhausted.',
      pitfalls:
        'An undersized load generator (not the target system) becomes the bottleneck — monitor the k6 host too.',
      interpretation:
        'vus hitting vus_max plus dropped_iterations means the achieved rate no longer matches the requested rate.'
    }
  },
  {
    name: 'data_received',
    type: 'counter',
    unit: 'bytes',
    education: {
      description: 'Total bytes received from the target system.',
      measures: 'Inbound bandwidth consumed by responses.',
      whyItMatters:
        'Response payload size drives latency, CDN cost, and mobile experience; regressions often hide here.',
      slaRecommendation: 'Occasionally part of cost SLAs (egress budgets).',
      sloRecommendation: 'Threshold when payload budgets matter, e.g. count < expected total.',
      bestPractices:
        'Enable discardResponseBodies globally when bodies are not needed — it reduces load-generator memory dramatically at high RPS.',
      pitfalls:
        'Compressed transfer sizes differ from decompressed body sizes; comparing runs with different Accept-Encoding is misleading.',
      interpretation:
        'A sudden jump between runs usually means an API started returning bigger payloads (missing pagination, verbose errors, disabled compression).'
    }
  },
  {
    name: 'data_sent',
    type: 'counter',
    unit: 'bytes',
    education: {
      description: 'Total bytes sent to the target system.',
      measures: 'Outbound bandwidth consumed by requests.',
      whyItMatters:
        'Large request bodies (uploads, batch APIs) shift the bottleneck to network and request parsing.',
      slaRecommendation: 'Rarely part of SLAs.',
      sloRecommendation: 'Threshold in upload-heavy scenarios to assert test realism.',
      bestPractices:
        'Watch this on the load-generator host: saturating its uplink invalidates all latency measurements.',
      pitfalls: 'Multipart encodings inflate payload size versus the raw file size.',
      interpretation:
        'If data_sent throughput plateaus before target RPS is reached, the generator network is the limit — scale out with distributed k6.'
    }
  },
  {
    name: 'checks',
    type: 'rate',
    unit: 'rate',
    education: {
      description: 'The rate of successful check() assertions.',
      measures:
        'The fraction of functional validations (status codes, body contents, JSON fields) that passed.',
      whyItMatters:
        'Checks catch what HTTP status alone cannot: wrong data, empty lists, broken contracts under load.',
      slaRecommendation: 'Functional correctness SLAs, e.g. “99.9% of responses are contractually valid”.',
      sloRecommendation:
        'rate > 0.99 is a sensible default; use rate == 1 for smoke tests where any failure should fail the run.',
      bestPractices:
        'Checks never abort iterations by themselves — pair them with a checks threshold so failures actually fail the test run.',
      pitfalls:
        'Forgetting the threshold: a test with 40% failing checks still exits 0 unless a threshold on checks exists.',
      interpretation:
        'Checks degrading while http_req_failed stays flat means the API returns 200s with bad payloads — a serious, easily-missed failure mode.'
    }
  },
  {
    name: 'group_duration',
    type: 'trend',
    unit: 'ms',
    education: {
      description: 'Wall-clock duration of a group() block, including all requests and sleeps inside it.',
      measures: 'Time spent in each logical step of a user journey.',
      whyItMatters: 'Lets you attribute journey slowness to a specific step (login vs search vs checkout).',
      slaRecommendation: 'Step-level SLAs, e.g. “search results within 2s”.',
      sloRecommendation: 'Threshold with a group tag: group_duration{group:::checkout} p(95) < 4000.',
      bestPractices:
        'Name groups after business steps; keep grouping shallow (1 level) so tags stay readable.',
      pitfalls:
        'Includes sleep() inside the group — put think time between groups if you want pure step latency.',
      interpretation: 'The slowest group under load is your first optimization target.'
    }
  }
]

export function builtinMetric(name: string): BuiltinMetricMeta | undefined {
  return BUILTIN_METRICS.find((m) => m.name === name)
}

export const METRIC_TYPE_LABEL: Record<MetricType, string> = {
  trend: 'Trend',
  counter: 'Counter',
  rate: 'Rate',
  gauge: 'Gauge'
}
