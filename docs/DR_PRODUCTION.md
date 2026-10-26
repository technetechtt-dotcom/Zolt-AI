# Production disaster recovery

Local Docker restore/PITR is engineering evidence only (restore RTO ~3.8 s, PITR RPO ~4.7 s, PITR RTO ~5.6 s on a single workstation).

Production DR still requires:

- Managed-environment restore into a **separate** target
- Encrypted backups
- Cross-zone / cross-region strategy
- Named recovery owner
- A test against contractual RPO/RTO

Until that test exists, production DR is **not proven**.
