# SECURITY.md

## Security

**QUEUE-JOBS-WORKER** is designed with a secure-by-default approach. Since the package executes user-defined processors and interacts with persistent storage, security is considered across the client, queue, worker, storage, and job lifecycle.

---

## Security Principles

The package follows these principles:

* Secure-by-default configuration
* Least-privilege access
* Input validation
* Explicit resource ownership
* Safe credential handling
* Controlled job execution
* Atomic state transitions
* Protection against unauthorized queue access

---

## Credential & Connection Security

Storage credentials and connection strings must be treated as sensitive information.

Applications should:

* Use environment variables or secure secret managers.
* Never hard-code credentials in source code.
* Use encrypted connections where supported.
* Avoid exposing connection strings through logs or errors.

The package must not log sensitive connection credentials.

---

## Job Payload Security

Job payloads may contain sensitive application data.

The package should:

* Avoid logging job payloads by default.
* Validate job data where appropriate.
* Preserve payload integrity during processing.
* Avoid exposing sensitive payload data through errors or events.

Users are responsible for determining whether sensitive data should be stored in job payloads.

---

## Worker Security

Workers execute user-defined processors and therefore should be treated as trusted application processes.

The package must:

* Prevent unauthorized job claiming.
* Enforce configured execution limits.
* Handle processor errors safely.
* Prevent sensitive internal information from being unnecessarily exposed.

The package does not provide a sandbox for untrusted JavaScript code.

---

## Queue Isolation

Queues should be isolated by their configured names and storage context.

Workers must only process jobs from queues they are explicitly configured to consume.

Queue access control beyond the package's internal boundaries is the responsibility of the host application and storage infrastructure.

---

## Storage Security

Storage adapters must use safe and parameterized operations where applicable.

Storage connections should support secure authentication and encrypted transport when provided by the underlying storage system.

The package core must not assume a specific storage security mechanism.

---

## Lock & Job Integrity

Job claiming and locking must use atomic storage operations where supported.

The system must prevent:

* Unauthorized job ownership changes
* Invalid job state transitions
* Concurrent processing caused by lock violations

Expired locks must be safely recoverable without corrupting job state.

---

## Error & Logging Security

Errors and logs must not unnecessarily expose:

* Credentials
* Connection strings
* Authentication tokens
* Sensitive job payloads
* Internal secrets

Error messages should provide sufficient debugging information without leaking sensitive infrastructure details.

---

## Dependency Security

Dependencies should be kept minimal and regularly reviewed.

The project should:

* Keep dependencies up to date.
* Audit dependencies for known vulnerabilities.
* Avoid unnecessary runtime dependencies.
* Pin or constrain versions where appropriate.

---

## User Responsibilities

Applications using **QUEUE-JOBS-WORKER** are responsible for:

* Securing their storage infrastructure.
* Protecting credentials and secrets.
* Validating application-specific job data.
* Implementing authorization around queue access.
* Securing user-defined processors.
* Running workers in trusted environments.
* Following applicable data-protection requirements.

---

## Vulnerability Reporting

Security vulnerabilities should be reported privately to the project maintainers rather than through public issue trackers.

Reports should include:

* Vulnerability description
* Affected version
* Reproduction steps
* Potential impact
* Suggested mitigation, if available

Security fixes should be prioritized according to severity and impact.
