# Horizontal scaling validation

The current soak and load tests exercise a single API, gateway and worker with concurrency limits.

Commercial scale requires a follow-up test of:

- Multiple API / gateway / worker replicas
- Shared Redis and PostgreSQL
- Load balancing and graceful rolling deployments
- Duplicate-job protection (already present via deterministic BullMQ `jobId` and recommendation SHA-256 ids)

That replica test has not been executed in a managed environment.
