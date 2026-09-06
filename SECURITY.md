# Security

This project follows a simple security approach: keep credentials safe, avoid exposing sensitive data, and treat worker execution as trusted application code.

## Basic Rules

- Keep connection strings and secrets in environment variables or a secret manager.
- Never hard-code credentials in source code.
- Do not log sensitive payloads, connection details, or tokens by default.
- Use secure database connections when your hosting provider supports them.
- Ensure workers only process authorized queues and trusted code paths.
- Prefer atomic locking and safe state transitions for job processing.
- Handle processor errors without leaking sensitive internals.

## Job and Payload Safety

Job payloads may contain sensitive information. The library should not expose them in logs or default error output. Applications should validate payload data and avoid storing unnecessary secrets in queue jobs.

## Worker Safety

Workers execute user-defined processor functions. That means they should run in a trusted environment and only be used with code you control. The package does not sandbox untrusted JavaScript.

## Storage Safety

Storage adapters should use secure authentication and encrypted transport whenever available. Queue state changes must remain atomic and consistent to avoid corruption or double-processing.

## Reporting a Vulnerability

Please report security issues privately to the project maintainers instead of opening a public issue.

Include:

- a short description of the issue
- affected version
- reproduction steps
- impact
- suggested fix if known

This project should be treated as a trusted runtime component in a secure application environment.
