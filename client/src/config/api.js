// Set REACT_APP_SERVER_IP to the master server's LAN address on each client.
export const SERVER_IP = process.env.REACT_APP_SERVER_IP || 'localhost';
export const SERVER_PORT = process.env.REACT_APP_SERVER_PORT || '5001';
export const API_BASE_URL = `http://${SERVER_IP}:${SERVER_PORT}/api/v1`;
export const WS_URL = `ws://${SERVER_IP}:${SERVER_PORT}`;

let rpcRequestCounter = 100;

export async function invokeRpc(method, params = {}) {
  const response = await fetch(`${API_BASE_URL}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: ++rpcRequestCounter,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'RPC execution error');
  }
  return data.result;
}
