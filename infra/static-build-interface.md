# Static build promotion interface

The public repository produces, but does not promote, the production site.

The `Static site build` workflow emits an artifact named
`gamebench-site-<git-sha>`. It contains the complete Astro output plus
`site-build.json`:

```json
{
  "schema_version": 1,
  "site_build_id": "<40-character Git commit>",
  "source_ref": "<Git ref>",
  "benchmark_versions": ["..."],
  "publication_ids": ["sha256:..."]
}
```

The private Ops repository is responsible for:

1. selecting an artifact by exact Git SHA;
2. verifying the workflow conclusion and build manifest;
3. copying it to `/srv/gamebench/releases/<sha>/site` or an equivalent
   immutable location;
4. keeping the content-addressed object root separate;
5. atomically changing the trusted site's `current` pointer;
6. testing the trusted and untrusted origins, CSP, iframe sandbox, cache
   policy, and an older immutable Publication URL.

No production host, SSH credential, domain secret, or monitoring state is
stored in this repository. `deploy-static.sh` remains a portable local example
of the filesystem layout, not the production source of truth.
