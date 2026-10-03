import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { Suspense } from "react";

import { Form } from "./form";

// Part of the static shell. Its one-second revalidate becomes the page's, so
// the prerendered entry turns stale one second after it was written.
async function CachedTime() {
  "use cache";
  cacheLife({ expire: 3600, revalidate: 1, stale: 60 });
  return <p>Cached at {new Date().toISOString()}</p>;
}

// The dynamic hole that makes this route partially prerendered.
async function RequestTime() {
  await connection();
  return <p>Rendered at {new Date().toISOString()}</p>;
}

export default function Page() {
  return (
    <main>
      <CachedTime />
      <Suspense fallback={<p>Loading…</p>}>
        <RequestTime />
      </Suspense>
      <Form />
    </main>
  );
}
