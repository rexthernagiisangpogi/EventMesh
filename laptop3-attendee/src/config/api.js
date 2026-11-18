export const SERVER_IP = process.env.REACT_APP_SERVER_IP || 'localhost';
export const SERVER_PORT = process.env.REACT_APP_SERVER_PORT || '5001';
const configuredApiUrl = process.env.REACT_APP_API_BASE_URL;
export const API_BASE_URL = configuredApiUrl
  ? new URL(configuredApiUrl, window.location.origin).toString().replace(/\/$/, '')
  : `http://${SERVER_IP}:${SERVER_PORT}/api/v1`;
const webSocketUrl = new URL(API_BASE_URL);
webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
webSocketUrl.pathname = '/';
webSocketUrl.search = '';
export const WS_URL = webSocketUrl.toString();
export const IS_LOCALHOST = !configuredApiUrl &&
  (SERVER_IP === 'localhost' || SERVER_IP === '127.0.0.1');
const STAFF_TOKEN_KEY = 'eventmesh_staff_token';

export function getStaffToken() {
  return localStorage.getItem(STAFF_TOKEN_KEY) || '';
}

export function clearStaffToken() {
  localStorage.removeItem(STAFF_TOKEN_KEY);
}

export async function loginStaff(password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP Error: ${response.status}`);
  localStorage.setItem(STAFF_TOKEN_KEY, data.token);
  return data.token;
}

export function staffFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getStaffToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

let rpcRequestCounter = 100;

export async function invokeRpc(method, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getStaffToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE_URL}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: ++rpcRequestCounter }),
  });
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'RPC execution error');
  return data.result;
}
