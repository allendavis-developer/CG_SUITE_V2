// 🔓 Public API
import {sendMessage} from '@/services/extensionBridge'

export async function scrapeEbay(params) {
  return sendMessage({
    action: "scrape",
    data: {
      competitors: ["eBay"],
      ...params,
    },
  });
}

export async function scrapeCashConverters(params) {
  return sendMessage({
    action: "scrape",
    data: {
      competitors: ["CashConverters"],
      ...params,
    },
  });
}
