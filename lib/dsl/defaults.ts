import { uid } from '@/lib/utils'
import type {
  CheckDef,
  CustomMetricDef,
  EnvVarDef,
  ExecutorConfig,
  ExecutorType,
  GlobalOptions,
  HttpRequestDef,
  KeyValue,
  ScenarioDef,
  SharedDataDef,
  StageDef,
  ThresholdDef
} from './types'

export function createKeyValue(key = '', value = ''): KeyValue {
  return { id: uid(), key, value, enabled: true }
}

export function createExecutorConfig(type: ExecutorType = 'constant-vus'): ExecutorConfig {
  return {
    type,
    vus: 10,
    iterations: 100,
    maxDuration: '10m',
    duration: '1m',
    startVUs: 0,
    stages: [createStage('30s', 10), createStage('1m', 10), createStage('30s', 0)],
    gracefulRampDown: '30s',
    rate: 30,
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: 20,
    maxVUs: 50
  }
}

export function createStage(duration = '30s', target = 10): StageDef {
  return { id: uid(), duration, target }
}

export function createScenario(name = 'default', type: ExecutorType = 'constant-vus'): ScenarioDef {
  return {
    id: uid(),
    name,
    typeId: 'custom',
    description: '',
    enabled: true,
    executor: createExecutorConfig(type),
    startTime: '0s',
    gracefulStop: '30s',
    tags: [],
    env: [],
    thresholds: []
  }
}

export function createRequest(partial?: Partial<HttpRequestDef>): HttpRequestDef {
  return {
    id: uid(),
    name: 'New Request',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    cookies: [],
    auth: { type: 'none' },
    body: { mode: 'none', raw: '', fields: [] },
    timeout: '60s',
    tags: [],
    checks: [createStatusCheck()],
    extractors: [],
    ...partial
  }
}

export function createStatusCheck(status = '200'): CheckDef {
  return {
    id: uid(),
    kind: 'status',
    label: `status is ${status}`,
    target: '',
    operator: 'eq',
    value: status
  }
}

export function createCheck(kind: CheckDef['kind'] = 'status'): CheckDef {
  switch (kind) {
    case 'duration':
      return { id: uid(), kind, label: 'response time < 500ms', target: '', operator: 'lt', value: '500' }
    case 'body-contains':
      return { id: uid(), kind, label: 'body contains text', target: '', operator: 'contains', value: '' }
    case 'json-path':
      return { id: uid(), kind, label: 'json field is valid', target: '', operator: 'exists', value: '' }
    case 'header':
      return {
        id: uid(),
        kind,
        label: 'header is present',
        target: 'Content-Type',
        operator: 'exists',
        value: ''
      }
    default:
      return createStatusCheck()
  }
}

export function createThreshold(metric = 'http_req_duration'): ThresholdDef {
  /* Sensible defaults per metric type: rates get rate<0.01 (or rate>0.99 for
     checks), counters count>0, gauges value<N, trends p(95)<500ms */
  let aggregation: ThresholdDef['aggregation'] = 'p(95)'
  let operator: ThresholdDef['operator'] = '<'
  let value = '500'
  if (metric === 'checks') {
    aggregation = 'rate'
    operator = '>'
    value = '0.99'
  } else if (metric === 'http_req_failed') {
    aggregation = 'rate'
    value = '0.01'
  } else if (metric === 'http_reqs' || metric === 'iterations' || metric.startsWith('data_')) {
    aggregation = 'count'
    operator = '>'
    value = '0'
  } else if (metric === 'vus' || metric === 'vus_max') {
    aggregation = 'value'
    value = '1000'
  }
  return {
    id: uid(),
    metric,
    aggregation,
    operator,
    value,
    abortOnFail: false,
    delayAbortEval: ''
  }
}

export function createCustomMetric(type: CustomMetricDef['type'] = 'trend'): CustomMetricDef {
  return {
    id: uid(),
    name: '',
    type,
    isTime: type === 'trend',
    description: ''
  }
}

export function createEnvVar(): EnvVarDef {
  return { id: uid(), name: '', defaultValue: '', required: false, description: '' }
}

export function createSharedData(): SharedDataDef {
  return {
    id: uid(),
    name: 'users',
    json: '[\n  { "username": "alice", "password": "secret" }\n]'
  }
}

export function createGlobalOptions(): GlobalOptions {
  return {
    userAgent: '',
    maxRedirects: 10,
    insecureSkipTLSVerify: false,
    discardResponseBodies: false,
    noConnectionReuse: false,
    throw: false,
    dns: { ttl: '5m', select: 'random', policy: 'preferIPv4' },
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'],
    tags: [],
    setupTimeout: '60s',
    teardownTimeout: '60s'
  }
}
