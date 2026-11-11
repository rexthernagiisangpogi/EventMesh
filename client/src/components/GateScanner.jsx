import React, { useEffect, useState } from 'react';
import { API_BASE_URL, invokeRpc } from '../config/api';

export default function GateScanner({ terminalId, tickets, onRefresh }) {
  const [qrInput, setQrInput] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const checkHealth = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      try {
        const response = await fetch(`${API_BASE_URL}/health`, {
          signal: controller.signal,
        });
        if (active) setIsOnline(response.ok);
      } catch {
        if (active) setIsOnline(false);
      } finally {
        clearTimeout(timeoutId);
      }
    };

    checkHealth();
    const intervalId = setInterval(checkHealth, 3000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  const validateTicket = async (event) => {
    event.preventDefault();
    const ticketHash = qrInput.trim();
    if (!ticketHash) return;
    if (!isOnline) {
      setScanResult({
        success: false,
        status: 'SERVER_UNAVAILABLE',
        message: 'Ticket validation requires a connection to the master server. No offline scan was accepted.',
      });
      return;
    }

    setBusy(true);
    setScanResult(null);
    try {
      const result = await invokeRpc('ValidateTicketProcedure', {
        ticket_hash: ticketHash,
        terminal_id: terminalId,
        timestamp: Math.floor(Date.now() / 1000),
      });
      setScanResult(result);
      if (result.success) setQrInput('');
      await onRefresh();
    } catch (error) {
      setIsOnline(false);
      setScanResult({
        success: false,
        status: 'VALIDATION_UNAVAILABLE',
        message: `Server validation failed. Ticket was not accepted: ${error.message}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={cardStyle}>
      <header style={headerStyle}>
        <h2>Gate validation · {terminalId}</h2>
        <strong
          role="status"
          style={{
            color: isOnline ? '#166534' : '#92400e',
            background: isOnline ? '#dcfce7' : '#fef3c7',
            padding: '6px 10px',
            borderRadius: 20,
          }}
        >
          {isOnline ? 'ONLINE · Master server connected' : 'OFFLINE · Validation disabled'}
        </strong>
      </header>

      <p>Ticket validation is online-only. Offline scans are not accepted or queued.</p>
      <form onSubmit={validateTicket} style={formStyle}>
        <input
          type="text"
          aria-label="Ticket QR payload"
          placeholder="Scan or paste ticket payload"
          value={qrInput}
          onChange={(event) => setQrInput(event.target.value)}
          style={inputStyle}
        />
        <button type="submit" disabled={busy || !isOnline} style={buttonStyle}>
          {busy ? 'Validating…' : 'Validate ticket'}
        </button>
      </form>

      <div style={{ marginTop: 12 }}>
        <strong>Demo tickets: </strong>
        {tickets.filter((ticket) => !ticket.is_validated).map((ticket) => (
          <button
            key={ticket.ticket_id}
            type="button"
            onClick={() => setQrInput(ticket.qr_hash)}
            style={demoButtonStyle}
          >
            {ticket.row_number}{ticket.seat_number} · {ticket.attendee_name}
          </button>
        ))}
      </div>

      {scanResult && (
        <p
          role="status"
          style={{
            ...resultStyle,
            color: scanResult.success ? '#166534' : '#991b1b',
            background: scanResult.success ? '#dcfce7' : '#fee2e2',
          }}
        >
          <strong>{scanResult.status || 'ERROR'}:</strong> {scanResult.message}
        </p>
      )}
    </section>
  );
}

const cardStyle = { background: '#fff', padding: 20, borderRadius: 10, boxShadow: '0 1px 3px #0000001a', marginBottom: 20 };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' };
const formStyle = { display: 'flex', gap: 10, marginTop: 16 };
const inputStyle = { flex: 1, minWidth: 0, padding: 10, fontFamily: 'monospace' };
const buttonStyle = { padding: '10px 18px', background: '#0f172a', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' };
const demoButtonStyle = { margin: '4px 6px', padding: '4px 8px', cursor: 'pointer' };
const resultStyle = { marginTop: 14, padding: 12, borderRadius: 8 };
