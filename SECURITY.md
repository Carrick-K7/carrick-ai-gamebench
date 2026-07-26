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

Report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/Carrick-K7/carrick-ai-gamebench/security/advisories/new)
before opening a public issue. Include the affected commit or release, a
minimal reproduction, impact, and any proposed mitigation. Do not attach
provider credentials, raw trajectories, or private run bundles.

Public issues and result-submission pull requests are not security reporting
channels. The private URL will move with the repository when it is transferred
to the target organization; GitHub preserves redirects from the current URL.
