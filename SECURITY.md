# Security Policy

Do not open a public issue containing an exploitable vulnerability, credential, private workflow, or user data. Contact the maintainers privately with reproduction steps, affected versions, impact, and a proposed mitigation if available.

The product is a hardened local-first v1, not a multi-tenant or remotely exposed service. Treat shell, Python, HTTP, MCP, custom nodes, and plugins as executable capabilities. Keep the server bound to loopback, use least privilege, review imported code, and back up data before upgrades.

Secrets must never be stored in workflow JSON. Values live in macOS Keychain behind opaque references, resolve only at approved adapter boundaries, and are covered by the release secret-canary gate. Imported code remains disabled until exact-manifest review. Ambiguous external effects stop in `needs_review`; they are never blindly retried. Consult [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for residual limitations, especially same-user filesystem races and arbitrary-process isolation.
