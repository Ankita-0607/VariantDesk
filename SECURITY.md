# Security

Please report vulnerabilities privately through GitHub Security Advisories on this repository rather than opening a public issue.

Deployment checklist for labs:

- Set a long random `JWT_SECRET` and change every password in `SEED_USERS` before first start.
- Serve VariantDesk over HTTPS behind your lab's reverse proxy; do not expose PostgreSQL.
- Back up the database (it holds the audit trail and signed reports).
- If you enable a cloud AI provider, confirm your data-processing agreement covers de-identified genomic data.
