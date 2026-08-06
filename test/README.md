# ConceptsOS end-to-end test

Proves the single-image design:

- **One container** (`conceptsos`) runs headscale + tailscaled + the Next.js app.
- The Next.js app is bound to the **tailnet interface only** — never eth0.
- Anything outside the tailnet cannot reach the app, even when it can reach
  headscale on the same docker network.

## Run

```bash
cd test
./run.sh
```

The script:

1. Builds `conceptsos:test` (the all-in-one image) and `conceptsos-tester:test`.
2. Starts `conceptsos` and waits for headscale `/health` + a self-tailnet IP.
3. Starts `outside-tester` on the docker network (NOT on the tailnet) and asserts
   `curl conceptsos:3000` and `curl <tailnet-ip>:3000` both fail.
4. Mints a headscale preauth key via `docker exec conceptsos headscale …`.
5. Starts `inside-tester` with that key, waits for `BackendState=Running`, and
   asserts `curl <tailnet-ip>:3000` returns `hello next js`.
6. Asserts that even the inside tester cannot reach `conceptsos:3000` via the
   docker network — the app is truly tailnet-only.

## Manual poking

```bash
docker compose -f test/docker-compose.yml up -d conceptsos
docker compose -f test/docker-compose.yml exec conceptsos \
    headscale -c /etc/conceptsos-vpn/headscale.yaml nodes list
```
