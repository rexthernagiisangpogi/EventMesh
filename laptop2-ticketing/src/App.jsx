import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, WS_URL, IS_LOCALHOST, clearStaffToken, getStaffToken, staffFetch } from './config/api';
import TicketingTerminal from './components/TicketingTerminal';
import StaffLogin from './components/StaffLogin';

export default function App() {
  const [events, setEvents] = useState([]);
  const [seats, setSeats] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [serverError, setServerError] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [staffToken, setStaffToken] = useState(getStaffToken);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/events`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
      setServerError('');
    } catch (e) {
      setServerError(e.message);
    }
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await staffFetch(`${API_BASE_URL}/state`);
      if (res.status === 401) {
        clearStaffToken();
        setStaffToken('');
        return;
      }
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setSeats(data.seats || []);
      setTickets(data.tickets || []);
    } catch {}
  }, []);

  const fetchAll = useCallback(() => {
    fetchEvents();
    fetchState();
  }, [fetchEvents, fetchState]);

  useEffect(() => {
    if (!staffToken) return undefined;
    let active = true;
    let socket;
    let reconnectTimer;
    fetchAll();
    const snapshotTimer = setInterval(fetchState, 30000);

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(WS_URL);
      socket.onopen = () => { if (active) setWsConnected(true); };
      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'SYSTEM_STATE' && msg.state) {
            fetchState();
            if (msg.state.events) fetchEvents();
          }
        } catch {}
      };
      socket.onerror = () => { if (active) setWsConnected(false); };
      socket.onclose = () => {
        if (!active) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      active = false;
      clearInterval(snapshotTimer);
      clearTimeout(reconnectTimer);
      if (socket) { socket.onclose = null; socket.close(); }
    };
  }, [fetchAll, fetchEvents, fetchState, staffToken]);

  if (!staffToken) {
    return <StaffLogin onLogin={() => setStaffToken(getStaffToken())} />;
  }

  return (
    <div style={pageStyle}>
      {IS_LOCALHOST && (
        <div style={warnStyle}>
          ⚠️ <strong>Not connected to Laptop 1.</strong> Set <code>REACT_APP_SERVER_IP</code> in <code>.env</code> to Laptop 1's LAN IP, then restart.
        </div>
      )}
      <header style={headerStyle}>
        <div>
          <strong style={{ fontSize: 20 }}>EventMesh · Ticketing Terminal</strong>
          <div style={{ color: '#cbd5e1', fontSize: 13 }}>Laptop 2 — Event, seat &amp; ticket management</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: wsConnected ? '#86efac' : '#fcd34d', fontSize: 13 }}>
            {wsConnected ? '● Live' : '○ Connecting…'}
            {serverError ? ` · Error: ${serverError}` : ''}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>Server: {new URL(API_BASE_URL).host}</div>
          <button type="button" onClick={() => { clearStaffToken(); setStaffToken(''); }} style={signOutStyle}>Sign out</button>
        </div>
      </header>
      <main style={mainStyle}>
        <TicketingTerminal
          events={events}
          seats={seats}
          tickets={tickets}
          nodeId="NODE_LAPTOP2"
          onRefresh={fetchAll}
        />
      </main>
    </div>
  );
}

const pageStyle = { minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' };
const warnStyle = { padding: '10px 24px', background: '#fef3c7', color: '#92400e', borderBottom: '1px solid #fcd34d', fontSize: 13 };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', background: '#0f172a', color: '#fff' };
const mainStyle = { maxWidth: 1250, margin: '24px auto', padding: '0 16px' };
const signOutStyle = { marginTop: 6, padding: '4px 8px', border: '1px solid #475569', borderRadius: 5, background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 11 };
