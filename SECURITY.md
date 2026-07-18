# Security

Do not run untrusted Agent commands directly on a workstation containing
credentials or unrelated source. The generic shell adapter executes the
provided command with the current user's permissions.

For controlled evaluations:

- use an isolated disposable machine or container;
- pass only credentials required by the selected model provider;
- enforce the task's outbound network policy outside the shell adapter;
- do not mount Docker sockets, SSH agents, or broad home directories;
- inspect evidence archives before extracting them elsewhere.

Report vulnerabilities privately to the Carrick AI GameBench maintainers
before opening a public issue.
