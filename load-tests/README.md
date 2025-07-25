# K6 Performance Testing Framework

Professional, scalable and modular performance testing framework built with K6, following Clean Code principles and hexagonal architecture patterns.

## Architecture Overview

```
load-tests/
├── config/
│   ├── endpoints.js         # API endpoints configuration
│   ├── payloads.js          # Reusable test payloads
│   └── options/
│       ├── smoke.options.js # Smoke test configuration
│       ├── load.options.js  # Load test configuration
│       └── stress.options.js# Stress test configuration
├── scenarios/
│   ├── getTest.js          # Reusable GET test scenario
│   └── postTest.js         # Reusable POST test scenario
├── tests/
│   ├── smoke.test.js       # Smoke test suite
│   ├── load.test.js        # Load test suite
│   └── stress.test.js      # Stress test suite
└── testRunner.js           # Framework documentation
```

## Test Types

- **Smoke Test**: Minimal load to verify endpoints are responding
- **Load Test**: Expected production load with gradual ramp-up
- **Stress Test**: Push infrastructure limits with aggressive load

## Quick Start

```bash
# Run smoke test
npm run test:smoke

# Run load test
npm run test:load

# Run stress test
npm run test:stress

# List all available tests
npm run test:list
```

## Custom Environment

```bash
# Test against different environment
BASE_URL=https://your-api.com npm run test:smoke:env
```

## Adding New APIs

1. **Add endpoints** to `config/endpoints.js`
2. **Add payloads** to `config/payloads.js`
3. **Create scenarios** in `scenarios/`
4. **Compose tests** in `tests/`

## Framework Principles

- **Separation of Concerns**: Configuration, scenarios, and tests are isolated
- **Reusable Components**: Scenarios can be imported across different test types
- **Clean Code**: Single responsibility, DRY, and SOLID principles
- **Hexagonal Architecture**: Domain logic decoupled from test orchestration 