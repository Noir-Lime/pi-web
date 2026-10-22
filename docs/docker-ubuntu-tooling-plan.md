# Ubuntu Docker tooling implementation record

The configuration contract is Ubuntu 26.04 for runtime and development images. It is intentionally breaking: there are no compatibility aliases, automatic configuration conversions, package translations, or transition safeguards. Deployment preparation is owned by the agents operating each installation.

Supported configuration and agent instructions live in [the Docker guide](../docker/README.md).

## Implemented scope

- Ubuntu base, modern Git from the stable Git PPA, configurable official Docker CLI/Compose/Buildx source.
- Pinned image-owned service Node and mise binaries.
- Persistent user-owned mise tools/configuration, inherited shims, explicit installs, paranoid project trust, and no system fallback through unresolved shims.
- Docker selects the service Node executable without changing PATH. PI WEB and its children inherit the ordinary tooling environment without application-side Docker/mise handling.
- User-owned image hooks, environment settings, and explicit local Compose overrides in both modes.
- Separate build/validation commands without service recreation.
- Human and credential-safe JSON diagnostics.
- Post-hook image tool/package manifest.
- Targeted ownership initialization without recursively walking persistent user tool stores at startup.

## Verification scope

Focused tests cover configuration precedence and persistence, local override loading, lifecycle helper forwarding, command routing, service interpreter selection and unchanged child PATH, Compose mount merging, and development dependency synchronization.

Disposable amd64 image checks cover runtime and development builds, nonroot execution, image manifest, runtime HTTP startup, service/project Node isolation, explicit mise Node/Python installs, login/non-login shim resolution, persistence after container recreation, and failure without implicit installation for missing versions. Playwright 1.64.1 Chromium, Firefox, and WebKit launched and interacted with local content in a separate disposable image without network access.

The interpreter-only launcher correction has passed 100 focused tests, scoped ESLint, typecheck, ShellCheck, both Dockerfile checks, and a disposable-container smoke using the published PI WEB 1.202610.6 package. That smoke confirms the image-owned service Node and PATH-selected child Node can differ without application-side handling. After the development rebuild, a shell-initialization dependency in the PATH test was isolated; the affected test, scoped ESLint, and typecheck passed again.

Arm64 execution has not been verified locally. Source-level checks and amd64 builds are not proof of arm64 runtime compatibility.

## Local deployment

Both development and production now run Ubuntu 26.04.1 LTS. Production retains the published PI WEB 1.202610.6 package, UID/GID 500:500, persistent data, and port 8504. An isolated candidate web/sessiond pair passed before the approved production recreation. Both production services became healthy and the runtime endpoint returned HTTP 200; the development container IDs and start times were unchanged by that operation.

Further deployment recreation requires approval because replacing sessiond interrupts active sessions.
