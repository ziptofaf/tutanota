# Desktop header-rejection fix

This personal fork is based on `tutanota-desktop-release-361.261006.0`
(commit `bbc38dbec458eb36379d499a3d1de9932a6be9e9`). The patch is on
`codex/retry-header-rejection`.

## Behavior

The shared REST client retries the observed HTTP 400 parser error containing
`HTTP ERROR 400 Illegal header name Content-Length` and URI `/badRequest`.
The match also requires an HTML content type and no application `Error-Id`.
It makes at most five total attempts, with delays of 250, 500, 1000 and
2000 milliseconds, preserving the request body and supporting cancellation.
If every attempt fails, it reports a connection error instead of treating
this as invalid credentials. Ordinary application errors retain their normal
handling. The error HTML is bounded in size and is never rendered or logged.

The server-side root cause remains unconfirmed. This change automates the
manual retry that previously allowed login and mailbox loading to succeed.

There is also a packaging correction that preserves unpacked `mac`/`mac-*`
output directories during desktop build cleanup.

## Build your own desktop client

Clone the patched branch, including its submodules:

```sh
git clone --branch codex/retry-header-rejection --recurse-submodules https://github.com/ziptofaf/tutanota.git
cd tutanota
```

Follow the prerequisites in [BUILDING.md](BUILDING.md). This release requires
Node.js 24.17.0 or later, Emscripten 3.1.59, and the Rust/native build tools
needed for your platform. Keep this branch checked out: switching to an
upstream release tag would remove the patch from your working tree.

```sh
npm ci
node desktop --custom-desktop-release
```

Run the desktop build on Windows to produce the Windows client. Its output
is placed in `artifacts/desktop/`. Use `--architecture x64` if you need to
select x64 explicitly. The upstream Windows builder downloads the MAPI
native dependency unless you provide a local build, as described in
[BUILDING.md](BUILDING.md).

Custom builds do not update automatically; incorporate future upstream
releases and rebuild. No Windows build has been validated in this fork yet.

## Validation

Thirteen integration tests cover the real XHR-to-REST path using a local HTTP
server: recovery on the fifth attempt, text/binary/no-body response modes,
POST body preservation, unrelated errors, exhaustion, and cancellation.
They passed using a focused development runner, and are registered in the
normal Node test suite under `HeaderRejectionRetry`:

```sh
npm test -- -f HeaderRejectionRetry
```

The full mail TypeScript build, focused test typecheck, lint, and formatting
checks passed. An Apple Silicon desktop build was packaged and launched,
and the user reported that the patched client successfully loaded mail.
This is not a guarantee that every intermittent server failure is resolved.
