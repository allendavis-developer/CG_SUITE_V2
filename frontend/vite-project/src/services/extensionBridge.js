/**
 * Extension bridge – forwards postMessage between the app page and Chrome extension (content-bridge.js).
 * Used by extensionClient.getDataFromListingPage('CeX') when user clicks "Add from CeX".
 *
 * Flow: We post EXTENSION_MESSAGE → content-bridge sends BRIDGE_FORWARD to background →
 * background opens CeX tab and stores pending. When user is on product-detail and clicks "Yes",
 * content-listings sends SCRAPED_DATA → background sends EXTENSION_RESPONSE_TO_PAGE to this tab →
 * content-bridge posts EXTENSION_RESPONSE → we resolve with the scraped data.
 *
 * Long-running flows can emit EXTENSION_PROGRESS (via EXTENSION_PROGRESS_TO_PAGE) if `onProgress` is passed.
 */
const EXTENSION_TIMEOUT = 600_000; // 10 minutes – user may take time to find the right listing page (eBay, Cash Converters, CeX, etc.)

/**
 * @param {object} message - forwarded to extension background
 * @param {{ onProgress?: (payload: unknown) => void, timeoutMs?: number }} [options]
 */
export function sendMessage(message, options = {}) {
  console.log('[extBridge][sendMessage] entry', { action: message?.action, hasOnProgress: !!options?.onProgress });
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Extension client can only run in the browser")
    );
  }

  const { onProgress, timeoutMs = EXTENSION_TIMEOUT } = options;

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID?.()
      || Math.random().toString(36).slice(2);
    console.log('[extBridge][sendMessage] requestId', requestId, 'timeoutMs', timeoutMs);

    const timeout = setTimeout(() => {
      console.log('[extBridge][sendMessage] timeout', requestId);
      cleanup();
      reject(new Error("Extension communication timeout"));
    }, timeoutMs);

    function onProgressEvent(event) {
      if (event.data?.type !== "EXTENSION_PROGRESS") return;
      if (event.data.requestId !== requestId) return;
      try {
        onProgress?.(event.data.payload);
      } catch (e) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[CG Suite] extension onProgress error", e);
        }
      }
    }

    function onResponse(event) {
      if (event.data?.type === "EXTENSION_RESPONSE") {
        console.log('[extBridge] EXTENSION_RESPONSE observed', { msgReqId: event.data.requestId, myReqId: requestId, matches: event.data.requestId === requestId });
      }
      if (
        event.data?.type === "EXTENSION_RESPONSE" &&
        event.data.requestId === requestId
      ) {
        cleanup();

        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.response);
        }
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener("message", onResponse);
      window.removeEventListener("message", onProgressEvent);
    }

    window.addEventListener("message", onResponse);
    if (onProgress) {
      window.addEventListener("message", onProgressEvent);
    }

    // content-bridge.js (injected on this origin) will receive this and forward to background
    console.log('[extBridge][sendMessage] posting EXTENSION_MESSAGE', requestId, message);
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
