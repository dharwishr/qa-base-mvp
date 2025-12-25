// Runtime configuration helper
// This reads from window.__RUNTIME_CONFIG__ which is injected at container startup

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      API_URL?: string;
    };
  }
}

function getConfig() {
  const runtimeConfig = window.__RUNTIME_CONFIG__;
  
  // Priority: runtime config > Vite env > fallback
  return {
    API_URL: runtimeConfig?.API_URL && runtimeConfig.API_URL !== '__API_URL__'
      ? runtimeConfig.API_URL
      : import.meta.env.VITE_API_URL || 'http://localhost:8000',
  };
}

export const config = getConfig();

// Helper to get WebSocket URL from API URL
export function getWsUrl(path: string): string {
  const apiUrl = config.API_URL;
  const wsProtocol = apiUrl.startsWith('https') ? 'wss' : 'ws';
  const baseUrl = apiUrl.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${baseUrl}${path}`;
}
