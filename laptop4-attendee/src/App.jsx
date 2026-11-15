import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, WS_URL, SERVER_IP, SERVER_PORT, IS_LOCALHOST } from './config/api';
import AttendeePortal from './components/AttendeePortal';
import './App.css';

export default function App() {
  const [events, setEvents] = useState([]);
  const [seats, setSeats] = useState([]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/events`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch (e) {
      console.error('Unable to load events:', e);
    }
  }, []);

  const fetchSeats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/state`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setSeats(data.seats || []);
    } catch {}
  }, []);

  const fetchAll = useCallback(() => {
    fetchEvents();
    fetchSeats();
  }, [fetchEvents, fetchSeats]);

  useEffect(() => {
    let active = true;
    let socket;
    let reconnectTimer;
    fetchAll();
    const snapshotTimer = setInterval(fetchSeats, 30000);

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(WS_URL);
      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'SYSTEM_STATE' && msg.state) {
            setSeats(msg.state.seats || []);
            // re-fetch events with images when state changes (e.g. new event created)
            if (msg.state.events) fetchEvents();
          }
        } catch {}
      };
      socket.onclose = () => {
        if (!active) return;
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
  }, [fetchAll, fetchEvents, fetchSeats]);

  return (
    <div style={pageStyle}>
      {IS_LOCALHOST && (
        <div style={warnStyle}>
          ⚠️ <strong>Not connected to Laptop 1.</strong> Set <code>REACT_APP_SERVER_IP</code> in <code>.env</code> to Laptop 1's LAN IP, then restart.
        </div>
      )}
      <header style={headerStyle}>
        <div style={brandStyle}>
          <div style={brandMarkStyle}>
            <img src="/eventmesh-logo.png" alt="EventMesh logo" style={logoStyle} />
          </div>
          <div>
            <strong style={{ fontSize: 20, letterSpacing: '-0.4px' }}>EventMesh</strong>
            <div style={{ color: '#f0df9e', fontSize: 12, marginTop: 2 }}>The Campus Event Organizer</div>
          </div>
        </div>
      </header>
      <main className="portal-main" style={mainStyle}>
        <AttendeePortal
          events={events}
          seats={seats}
          onRefresh={fetchAll}
        />
      </main>
    </div>
  );
}

const pageStyle = { minHeight: '100vh', backgroundColor: '#edf4f8', backgroundImage: 'linear-gradient(rgba(242, 247, 250, 0.72), rgba(242, 247, 250, 0.72)), url("/eventmesh-background.jpg")', backgroundPosition: 'center center', backgroundSize: 'cover', backgroundAttachment: 'fixed', fontFamily: 'system-ui, sans-serif', color: '#213247' };
const warnStyle = { padding: '10px 24px', background: '#fef3c7', color: '#92400e', borderBottom: '1px solid #fcd34d', fontSize: 13 };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '16px max(24px, calc((100% - 1080px) / 2))', background: 'linear-gradient(112deg, rgba(30, 48, 71, 0.97), rgba(38, 92, 130, 0.94) 58%, rgba(35, 133, 139, 0.94))', color: '#f6fbff', boxShadow: '0 8px 28px #12283b44', borderBottom: '1px solid #72d6cf77' };
const brandStyle = { display: 'flex', alignItems: 'center', gap: 12 };
const brandMarkStyle = { width: 52, height: 52, display: 'grid', placeItems: 'center', flexShrink: 0, borderRadius: 15, background: '#fff', boxShadow: '0 4px 14px #102e4c44', overflow: 'hidden' };
const logoStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const mainStyle = { maxWidth: 1080, margin: '0 auto', padding: '42px 24px 64px' };
