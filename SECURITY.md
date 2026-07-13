# Security Policy

Do not open a public issue containing an exploitable vulnerability, credential, private workflow, or user data. Contact the maintainers privately with reproduction steps, affected versions, impact, and a proposed mitigation if available.

The product is under active development and is not yet represented as enterprise-ready. Treat shell, Python, HTTP, MCP, custom nodes, and plugins as executable capabilities. Keep the server bound to loopback, use least privilege, review imported code, and back up data before upgrades.

Secrets must never be stored in workflow JSON. Current secret-store hardening remains open; consult [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) before production use.
