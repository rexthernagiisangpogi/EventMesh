export const SERVER_IP = process.env.REACT_APP_SERVER_IP || 'localhost';
export const SERVER_PORT = process.env.REACT_APP_SERVER_PORT || '5001';
export const API_BASE_URL = `http://${SERVER_IP}:${SERVER_PORT}/api/v1`;
export const WS_URL = `ws://${SERVER_IP}:${SERVER_PORT}`;
export const IS_LOCALHOST = SERVER_IP === 'localhost' || SERVER_IP === '127.0.0.1';

let rpcRequestCounter = 100;

export async function invokeRpc(method, params = {}) {
  const response = await fetch(`${API_BASE_URL}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: ++rpcRequestCounter }),
  });
  const responseBody = await response.text();
  let data;
  try {
    data = responseBody ? JSON.parse(responseBody) : {};
  } catch {
    throw new Error(`HTTP Error: ${response.status}. The server returned an invalid response.`);
  }
  if (!response.ok) {
    const message = data.error?.message || data.message || `HTTP Error: ${response.status}`;
    throw new Error(message);
  }
  if (data.error) throw new Error(data.error.message || 'RPC execution error');
  return data.result;
}
