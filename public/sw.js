self.addEventListener("install", (event) => {
  self.skipWaiting();
});

const requests = {};

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  console.log(event.request.mode);
  if (url.pathname.startsWith("/_/")) {
    event.respondWith(
      (async () => {
        if (!event.clientId) return;

        const client = await self.clients.get(event.clientId);
        if (!client) return;

        if (!requests[event.request.url]) {
          let requestPromiseResolve;

          const requestPromise = new Promise((resolve) => {
            requestPromiseResolve = resolve;
          });

          requests[event.request.url] = {
            promise: requestPromise,
            resolve: requestPromiseResolve,
          };


            client.postMessage({
                url: event.request.url,
                method: event.request.method,
                body: await event.request.blob()
            });
        }

        const body = await requests[event.request.url].promise;

        return new Response(body);
      })(),
    );
  } else {
    event.respondWith(fetch(event.request));
  }
});

addEventListener("message", (event) => {
  if (requests[event.data.url]) {
    const resolve = requests[event.data.url].resolve;
    delete requests[event.data.url];
    resolve(event.data.body);
  } else {
    console.log(`[sw] Double request for ${event.data.url}, dropping`);
  }
});
