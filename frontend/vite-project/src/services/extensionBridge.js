// services/api/extensionClient.js

const EXTENSION_TIMEOUT = 60_000;

export function sendMessage(message) {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Extension client can only run in the browser")
    );
  }

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID?.() 
      || Math.random().toString(36).slice(2);

    const timeout = setTimeout(() => {
      window.removeEventListener("message", onResponse);
      reject(new Error("Extension communication timeout"));
    }, EXTENSION_TIMEOUT);

    function onResponse(event) {
      if (
        event.data?.type === "EXTENSION_RESPONSE" &&
        event.data.requestId === requestId
      ) {
        clearTimeout(timeout);
        window.removeEventListener("message", onResponse);

        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.response);
        }
      }
    }

    window.addEventListener("message", onResponse);

    window.postMessage(
      {
        type: "EXTENSION_MESSAGE",
        requestId,
        message,
      },
      "*"
    );
  });
}
