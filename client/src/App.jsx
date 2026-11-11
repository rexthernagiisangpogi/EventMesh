import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, WS_URL } from './config/api';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import GateScanner from './components/GateScanner';
import TicketingTerminal from './components/TicketingTerminal';

const ROLES = {
  ticketing: 'LAPTOP_2_TICKETING',
  gate: 'LAPTOP_3_GATE_ANALYTICS',
};

const initialState = {
  seats: [],
  tickets: [],
  recentLogs: [],
  metrics: {},
};

export default function App() {
  const [role, setRole] = useState(
    process.env.REACT_APP_NODE_ROLE || ROLES.ticketing
  );
  const [systemState, setSystemState] = useState(initialState);
  const [alerts, setAlerts] = useState([]);
  const [serverError, setServerError] = useState('');
  const [webSocketConnected, setWebSocketConnected] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/state`);
      if (!response.ok) {
        throw new Error(`State request failed with status ${response.status}`);
      }
      const snapshot = await response.json();
      setSystemState(snapshot);
      setServerError('');
    } catch (error) {
      setServerError(error.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let socket;
    let reconnectTimer;
    fetchSnapshot();
    const snapshotTimer = setInterval(fetchSnapshot, 10000);

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        if (active) setWebSocketConnected(true);
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== 'SYSTEM_STATE' || !message.state) return;
          setSystemState(message.state);
          setServerError('');
          if (message.state.alert) {
            setAlerts((previous) => [
              message.state.alert,
              ...previous.slice(0, 4),
            ]);
          }
        } catch (error) {
          console.error('Unable to process WebSocket state update:', error);
        }
      };
      socket.onerror = () => {
        if (active) setWebSocketConnected(false);
      };
      socket.onclose = () => {
        if (!active) return;
        setWebSocketConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      active = false;
      clearInterval(snapshotTimer);
      clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [fetchSnapshot]);

  const button = (buttonRole, label) => (
    <button
      type="button"
      onClick={() => setRole(buttonRole)}
      style={{ ...roleButtonStyle, ...(role === buttonRole ? activeRoleStyle : {}) }}
    >
      {label}
    </button>
  );

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <strong style={{ fontSize: 20 }}>EventMesh</strong>
          <div style={{ color: '#cbd5e1', fontSize: 13 }}>
            Distributed event ticketing and gate management
          </div>
        </div>
        <nav aria-label="Terminal role" style={navStyle}>
          {button(ROLES.ticketing, 'Laptop 2 · Ticketing')}
          {button(ROLES.gate, 'Laptop 3 · Gate + Analytics')}
        </nav>
      </header>

      <main style={mainStyle}>
        <p role="status" style={{ color: webSocketConnected ? '#166534' : '#92400e' }}>
          {webSocketConnected ? 'Live server updates connected' : 'Connecting to live server updates…'}
          {serverError ? ` Snapshot error: ${serverError}` : ''}
        </p>

        {role === ROLES.ticketing && (
          <TicketingTerminal
            seats={systemState.seats || []}
            tickets={systemState.tickets || []}
            nodeId="NODE_LAPTOP2"
            onRefresh={fetchSnapshot}
          />
        )}
        {role === ROLES.gate && (
          <>
            <GateScanner
              terminalId="GATE_TERM_01_LAPTOP3"
              tickets={systemState.tickets || []}
              onRefresh={fetchSnapshot}
            />
            <AnalyticsDashboard
              metrics={systemState.metrics || {}}
              recentLogs={systemState.recentLogs || []}
              alerts={alerts}
            />
          </>
        )}
      </main>
    </div>
  );
}

const pageStyle = { minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 24px', background: '#0f172a', color: '#fff' };
const navStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const roleButtonStyle = { padding: '8px 12px', border: 0, borderRadius: 6, background: '#1e293b', color: '#fff', cursor: 'pointer', fontWeight: 700 };
const activeRoleStyle = { background: '#3b82f6' };
const mainStyle = { maxWidth: 1250, margin: '24px auto', padding: '0 16px' };
