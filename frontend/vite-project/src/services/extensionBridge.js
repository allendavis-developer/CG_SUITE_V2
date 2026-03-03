/**
 * Extension bridge – forwards postMessage between the app page and Chrome extension (content-bridge.js).
 * Used by extensionClient.getDataFromListingPage('CeX') when user clicks "Add from CeX".
 *
 * Flow: We post EXTENSION_MESSAGE → content-bridge sends BRIDGE_FORWARD to background →
 * background opens CeX tab and stores pending. When user is on product-detail and clicks "Yes",
 * content-listings sends SCRAPED_DATA → background sends EXTENSION_RESPONSE_TO_PAGE to this tab →
 * content-bridge posts EXTENSION_RESPONSE → we resolve with the scraped data.
 */
const EXTENSION_TIMEOUT = 600_000; // 10 minutes – user may take time to find the right listing page (eBay, Cash Converters, CeX, etc.)

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

    // content-bridge.js (injected on this origin) will receive this and forward to background
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
