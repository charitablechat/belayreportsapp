// This bootstrap endpoint has been permanently disabled.
//
// Previously it accepted unauthenticated requests and reset a specific
// super-admin account to a hardcoded password using the service-role key,
// which allowed anyone who discovered the URL to seize super-admin access.
//
// It is retained only as a stub so external callers get a clear 410 Gone
// response. Any legitimate super-admin bootstrap must now be performed
// manually by a trusted operator against the database directly.

Deno.serve(() => {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "This endpoint has been permanently disabled for security reasons.",
    }),
    {
      status: 410,
      headers: { "content-type": "application/json" },
    },
  );
});
