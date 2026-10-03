# Server Action on a stale PPR page logs `Error: Unexpected end of form`

A minimal reproduction for Next.js 16.3.8, the current `latest`.

This is [vercel/next.js#96519](https://github.com/vercel/next.js/issues/96519), fixed on canary by [vercel/next.js#96640](https://github.com/vercel/next.js/pull/96640) and not reproducible with 16.4.0-canary.58. The fix has not been backported to 16.3.x, so 16.3.8 is still affected.

With `cacheComponents` enabled, posting a Server Action to a partially prerendered page whose cached entry is stale makes the server log

```
⨯ Error: Unexpected end of form
    at ignore-listed frames {
  digest: '…'
}
```

The action itself succeeds and returns its result. The error comes from a second, background render of the same request.

## Reproduce

```sh
npm ci
npm run build
npm run repro
```

`npm run repro` starts `next start`, waits two seconds so that the prerendered `/` is stale (its shell holds a `"use cache"` with `revalidate: 1`), and posts the page's Server Action three times the way `useActionState` does. It prints the server log, and exits with 1 when the log contains `Unexpected end of form`:

```
[next] ⨯ Error: Unexpected end of form
    at ignore-listed frames {
  digest: '389111841'
}
action #1: HTTP 200, action result returned: true
[next] (node:…) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 end listeners added to [IncomingMessage]. MaxListeners is 10. …
action #2: HTTP 200, action result returned: true
action #3: HTTP 200, action result returned: true

REPRODUCED: the server logged `Error: Unexpected end of form` for a Server Action that succeeded.
```

The same happens from a browser: `npm run build && npm start`, open http://localhost:3000, wait a couple of seconds, and press **Submit**. The page shows `Received hello`, and the terminal shows the error.

The [Reproduce](.github/workflows/repro.yml) workflow runs the same steps on GitHub Actions; a failing run means the bug reproduced.

## Expected

A Server Action request is handled once. Its body is read once, and the server logs nothing for an action that succeeded.

## Actual

For a Server Action request (`isPossibleServerAction`) on a route with `renderingMode: "PARTIALLY_STATIC"`, the app-page handler reads the route's `APP_PAGE` entry from the incremental cache to resume from its postponed state. When that entry is stale (`isStale === -1 || isStale === true`), it schedules a background revalidation on the next tick, and that revalidation renders the page with the **same request object**:

[`packages/next/src/build/templates/app-page-runtime.ts` (v16.3.8), lines 1414–1457](https://github.com/vercel/next.js/blob/v16.3.8/packages/next/src/build/templates/app-page-runtime.ts#L1414-L1457)

The request still carries `Next-Action`, so the background render enters the Server Action handler again and pipes the request body into busboy a second time. The first render has already consumed the body, so busboy receives an empty stream that ends before the closing boundary and fails in `_final` with `Unexpected end of form`. The response to the client was produced by the first render, which is why the action appears to work.

Tracing `Readable.prototype.pipe` on the request confirms it: on a stale entry the multipart body is piped twice per action request, the second time from a render scheduled by that background revalidation (its stack goes through the response cache's `handleRevalidate`); on a fresh entry it is piped once.

This reproduction makes the entry stale with a short `cacheLife`, but a short `cacheLife` is not needed. When the stored entry was written by another process, such as another instance sharing a custom `cacheHandler`, the reading process's `cacheControls` do not know the path, and `IncrementalCache.calculateRevalidate` falls back to revalidating after one second. On a multi-instance deployment with a shared cache, this path is therefore reached routinely.

## Fixed on canary

[vercel/next.js#96640](https://github.com/vercel/next.js/pull/96640) gives the App Page route module a separate `prerender` operation and makes a forced static render, which is what this background revalidation is, use it instead of `render`. With 16.4.0-canary.58 the background revalidation is still scheduled from the Server Action request, but the multipart body is piped once per request and nothing is logged:

```sh
npm install next@16.4.0-canary.58
npm run build
npm run repro   # Not reproduced: no `Unexpected end of form` in the server log.
```

A narrower change for 16.3.x would be not to schedule the background revalidation from a Server Action request at all. Applied to 16.3.8 it also removes both the error and the `MaxListenersExceededWarning`:

```diff
               if (
                 incrementalCacheEntry &&
                 (incrementalCacheEntry.isStale === -1 ||
-                  incrementalCacheEntry.isStale === true)
+                  incrementalCacheEntry.isStale === true) &&
+                !isPossibleServerAction
               ) {
```

## Environment

- Next.js 16.3.8 (reproduces); 16.4.0-canary.58 (does not reproduce)
- React 19.3.0
- Node.js 24.21.0
- `next build` (Turbopack) and `next start`
