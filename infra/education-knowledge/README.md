# Education knowledge storage

This local stack runs the two durable stores used by the reviewed education
publication pipeline:

- Qdrant: dense + lexical sparse vectors and RRF retrieval.
- Neo4j: versioned education entities, typed relations, and the active-release
  control plane.

## Start

1. Install a Docker-compatible container runtime.
2. Copy `.env.example` to `.env` and replace the Neo4j password.
3. Run:

   ```bash
   docker-compose --env-file .env up -d
   ```

4. Put the same password in the application's untracked `.env` as
   `NEO4J_PASSWORD`. Keep `QDRANT_URL` and `NEO4J_URI` on loopback for local
   development.

The application never switches a corpus to a new release until both stores
have received and validated the same release. A failed partial write remains
inactive and therefore cannot appear in retrieval.

## Stop

```bash
docker-compose --env-file .env down
```

Add `--volumes` only when you intentionally want to destroy all local Qdrant
and Neo4j data.
