# Custom Node Authoring

Use **My Nodes → Create a custom node** to define purpose, typed input/output ports, implementation adapter, permissions, tests, and documentation.

Supported adapters currently include agent, Python, shell, HTTP, MCP, and deterministic transform. Definitions are versioned and carry provenance and trust state. A catalog entry is not executable unless its adapter has runtime behavior and verification.

Imported executable definitions must be reviewed before enabling. Keep permissions minimal and include deterministic success and failure fixtures.
