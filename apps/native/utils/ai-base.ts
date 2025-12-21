// @ts-nocheck

/**
 * Manages a list of CORS proxies with failover capabilities.
 */
export class CorsProxyManager {
  /**
   * @param {string[]} proxies - An array of CORS proxy base URLs.
   */
  constructor(
    proxies = [
      "https://corsproxy.io/?",
      "https://api.allorigins.win/raw?url=",
      "https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?",
      "https://proxy.cors.sh/",
      "https://cors-anywhere.herokuapp.com/",
      "https://thingproxy.freeboard.io/fetch/",
      "https://cors.bridged.cc/",
      "https://cors-proxy.htmldriven.com/?url=",
      "https://yacdn.org/proxy/",
      "https://api.codetabs.com/v1/proxy?quest=",
    ]
  ) {
    if (!Array.isArray(proxies) || proxies.length === 0) {
      throw new Error(
        "CorsProxyManager requires a non-empty array of proxy URLs."
      );
    }
    this.proxies = proxies;
    this.currentIndex = 0;
  }

  /**
   * Gets the full proxied URL for the current proxy.
   * @param {string} targetUrl - The URL to be proxied.
   * @returns {string} The full proxied URL.
   */
  getProxiedUrl(targetUrl) {
    const proxy = this.proxies[this.currentIndex];
    return proxy + encodeURIComponent(targetUrl);
  }

  /**
   * Rotates to the next proxy in the list.
   */
  rotateProxy() {
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    console.warn(
      `Rotated to next CORS proxy: ${this.proxies[this.currentIndex]}`
    );
  }
}
