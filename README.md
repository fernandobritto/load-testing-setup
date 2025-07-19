# timesheet-admin

This repository provides a basic setup to run load tests using [k6](https://k6.io/).

## Setup

1. Install k6 (if not already installed):
   ```bash
   sudo apt-get update && sudo apt-get install -y k6
   ```
   or follow the instructions for your operating system in the [k6 documentation](https://k6.io/docs/getting-started/installation/).

2. Create a `.env` file based on `.env.example` and set the target API URL and access token.

## Running the load test

Execute the following command:

```bash
k6 run --env-file=.env k6/load-test.js
```

The script issues scalable GET and POST requests to the configured API.
