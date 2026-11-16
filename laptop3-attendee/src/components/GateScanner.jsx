import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { API_BASE_URL, invokeRpc } from '../config/api';

const TERMINAL_ID = 'GATE_TERM_01_LAPTOP3';

export default function GateScanner({ tickets, onRefresh }) {
  const [qrInput, setQrInput] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [viewingTicket, setViewingTicket] = useState(null);
  const [deletingTicketId, setDeletingTicketId] = useState(null);
  const [ticketMessage, setTicketMessage] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState('');

  const [debugInfo, setDebugInfo] = useState('');

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setDebugInfo('getUserMedia not supported on this browser/connection.');
    } else {
      setDebugInfo('getUserMedia available.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
        if (active) setIsOnline(res.ok);
      } catch {
        if (active) setIsOnline(false);
      } finally {
        clearTimeout(t);
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const validate = useCallback(async (e, scannedPayload) => {
    e?.preventDefault();
    const hash = (scannedPayload ?? qrInput).trim();
    if (!hash) return;
    if (!isOnline) {
      setScanResult({ success: false, status: 'SERVER_UNAVAILABLE', message: 'Server is offline. Validation requires an active connection.' });
      return;
    }
    setBusy(true);
    setScanResult(null);
    try {
      const result = await invokeRpc('ValidateTicketProcedure', {
        ticket_hash: hash,
        terminal_id: TERMINAL_ID,
        timestamp: Math.floor(Date.now() / 1000),
      });
      setScanResult(result);
      if (result.success) setQrInput('');
      await onRefresh();
    } catch (err) {
      setIsOnline(false);
      setScanResult({ success: false, status: 'ERROR', message: err.message });
    } finally {
      setBusy(false);
    }
  }, [isOnline, onRefresh, qrInput]);

  const videoRef = useRef(null);

  useEffect(() => {
    if (!scannerOpen) return undefined;

    let active = true;
    let stream = null;
    let rafId = null;

    const tick = (video, canvas, ctx) => {
      if (!active) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          active = false;
          setScannerOpen(false);
          setScannerError('');
          setQrInput(code.data);
          validate(null, code.data);
          return;
        }
      }
      rafId = requestAnimationFrame(() => tick(video, canvas, ctx));
    };

    const start = async () => {
      try {
        setDebugInfo('Requesting camera...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        setDebugInfo('Stream obtained, attaching to video...');
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        const video = videoRef.current;
        if (!video) { setDebugInfo('ERROR: video element not found'); return; }
        video.srcObject = stream;
        await video.play();
        setDebugInfo('Video playing, scanning...');
        setScannerActive(true);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        rafId = requestAnimationFrame(() => tick(video, canvas, ctx));
      } catch (err) {
        if (!active) return;
        setDebugInfo(`ERROR ${err?.name}: ${err?.message}`);
        const msg = err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Tap the camera icon in the address bar and allow access.'
          : err?.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `${err?.name}: ${err?.message}`;
        setScannerError(msg);
        setScannerOpen(false);
      }
    };

    start();
    return () => {
      active = false;
      setScannerActive(false);
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [scannerOpen, validate]);

  const pending = tickets.filter((t) => !t.is_validated);
  const checkedIn = tickets.filter((t) => t.is_validated);
  const filtered = (list) => list.filter((t) =>
    !search ||
    t.attendee_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.seat_label?.toLowerCase().includes(search.toLowerCase()) ||
    t.event_name?.toLowerCase().includes(search.toLowerCase())
  );

  const deleteTicket = async (ticket) => {
    const eventName = ticket.event_name || 'Unknown event';
    const confirmed = window.confirm(
      `Delete ${ticket.attendee_name}'s ticket for "${eventName}"? This will release the seat and cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingTicketId(ticket.ticket_id);
    setTicketMessage(null);
    try {
      const result = await invokeRpc('DeleteTicketProcedure', { ticket_id: ticket.ticket_id });
      if (!result.success) {
        setTicketMessage({ success: false, message: result.message });
        return;
      }
      if (viewingTicket?.ticket_id === ticket.ticket_id) setViewingTicket(null);
      setTicketMessage({ success: true, message: result.message });
      await onRefresh();
    } catch (error) {
      setTicketMessage({ success: false, message: error.message });
    } finally {
      setDeletingTicketId(null);
    }
  };

  const renderTicket = (ticket, validated) => (
    <li key={ticket.ticket_id} style={{ ...rowStyle, ...(validated ? { opacity: 0.8 } : {}) }}>
      <div style={{ minWidth: 0 }}>
        <strong>{ticket.attendee_name}</strong>
        <div style={ticketMetaStyle}>{ticket.event_name || 'Unknown event'}</div>
        <div style={ticketMetaStyle}>Seat {ticket.seat_label}</div>
      </div>
      <div style={ticketActionsStyle}>
        <span style={{
          ...badgeStyle,
          background: validated ? '#dcfce7' : '#fef9c3',
          color: validated ? '#166534' : '#854d0e',
        }}>
          {validated ? '✓ In' : 'Pending'}
        </span>
        <button type="button" onClick={() => setViewingTicket(ticket)} style={viewBtnStyle}>
          View
        </button>
        <button
          type="button"
          onClick={() => deleteTicket(ticket)}
          disabled={deletingTicketId === ticket.ticket_id}
          style={deleteBtnStyle}
        >
          {deletingTicketId === ticket.ticket_id ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </li>
  );

  return (
    <div style={layoutStyle}>
      {/* Validator panel */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h2 style={{ margin: 0 }}>Ticket Validator</h2>
          <span style={{ ...badgeStyle, background: isOnline ? '#dcfce7' : '#fef3c7', color: isOnline ? '#166534' : '#92400e' }}>
            {isOnline ? '● Online' : '○ Offline'}
          </span>
        </div>

        <form onSubmit={validate} style={{ marginTop: 20 }}>
          <label style={labelStyle}>Paste or scan ticket payload</label>
          <textarea
            style={textareaStyle}
            placeholder="Paste ticket payload here…"
            value={qrInput}
            onChange={(e) => setQrInput(e.target.value)}
            disabled={scannerOpen}
            rows={3}
          />
          <button type="submit" disabled={busy || !isOnline} style={btnStyle}>
            {busy ? 'Validating…' : 'Validate Ticket'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setScannerError('');
            setScannerOpen((open) => !open);
          }}
          disabled={!isOnline || busy}
          style={{ ...scanButtonStyle, opacity: !isOnline || busy ? 0.6 : 1 }}
        >
          {scannerOpen ? scannerActive ? 'Close QR scanner' : 'Starting camera…' : 'Scan QR ticket'}
        </button>
        {scannerOpen && (
          <video
            ref={videoRef}
            playsInline
            muted
            style={scannerContainerStyle}
          />
        )}
        {scannerError && <p role="alert" style={scannerErrorStyle}>{scannerError}</p>}
        <p style={{ fontSize: 11, color: '#64748b', marginTop: 6, wordBreak: 'break-all' }}>Debug: {debugInfo}</p>

        {scanResult && (
          <div style={{ ...resultStyle, background: scanResult.success ? '#dcfce7' : '#fee2e2', borderColor: scanResult.success ? '#86efac' : '#fca5a5' }}>
            <strong style={{ fontSize: 16 }}>{scanResult.success ? '✓ Access Granted' : '✗ Access Denied'}</strong>
            <p style={{ margin: '6px 0 0', color: scanResult.success ? '#166534' : '#991b1b' }}>
              {scanResult.message}
            </p>
          </div>
        )}

        {/* Quick-fill from pending tickets */}
        {pending.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={labelStyle}>Quick-fill from pending tickets:</p>
            <div style={chipRowStyle}>
              {pending.map((t) => (
                <button key={t.ticket_id} type="button"
                  onClick={() => { setQrInput(t.qr_hash); setScanResult(null); }}
                  style={chipStyle}>
                  {t.seat_label} · {t.attendee_name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Ticket list panel */}
      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>All Tickets</h2>
        <input style={inputStyle} placeholder="Search by name, event or seat…"
          value={search} onChange={(e) => setSearch(e.target.value)} />

        <div style={statsRowStyle}>
          <span style={{ ...badgeStyle, background: '#fef9c3', color: '#854d0e' }}>{pending.length} pending</span>
          <span style={{ ...badgeStyle, background: '#dcfce7', color: '#166534' }}>{checkedIn.length} checked in</span>
        </div>
        {ticketMessage && (
          <p role="status" style={{ color: ticketMessage.success ? '#166534' : '#991b1b' }}>
            {ticketMessage.message}
          </p>
        )}

        {tickets.length === 0 && <p style={{ color: '#64748b' }}>No tickets issued yet.</p>}

        {filtered(pending).length > 0 && (
          <>
            <p style={sectionLabelStyle}>Pending</p>
            <ul style={listStyle}>
              {filtered(pending).map((ticket) => renderTicket(ticket, false))}
            </ul>
          </>
        )}

        {filtered(checkedIn).length > 0 && (
          <>
            <p style={sectionLabelStyle}>Checked In</p>
            <ul style={listStyle}>
              {filtered(checkedIn).map((ticket) => renderTicket(ticket, true))}
            </ul>
          </>
        )}
      </section>

      {viewingTicket && (
        <div style={modalBackdropStyle} onClick={() => setViewingTicket(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-details-title"
            style={ticketDetailsStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={cardHeaderStyle}>
              <h2 id="ticket-details-title" style={{ margin: 0 }}>Ticket Details</h2>
              <button type="button" onClick={() => setViewingTicket(null)} style={closeBtnStyle}>
                Close
              </button>
            </div>
            <dl style={detailsListStyle}>
              <dt style={detailLabelStyle}>Customer</dt>
              <dd style={detailValueStyle}>{viewingTicket.attendee_name}</dd>
              <dt style={detailLabelStyle}>Event</dt>
              <dd style={detailValueStyle}>{viewingTicket.event_name || 'Unknown event'}</dd>
              <dt style={detailLabelStyle}>Seat</dt>
              <dd style={detailValueStyle}>{viewingTicket.seat_label}</dd>
              <dt style={detailLabelStyle}>Address</dt>
              <dd style={detailValueStyle}>{viewingTicket.attendee_address || 'Not provided'}</dd>
              <dt style={detailLabelStyle}>Phone</dt>
              <dd style={detailValueStyle}>{viewingTicket.attendee_phone || 'Not provided'}</dd>
              <dt style={detailLabelStyle}>Email</dt>
              <dd style={detailValueStyle}>{viewingTicket.attendee_email || 'Not provided'}</dd>
              <dt style={detailLabelStyle}>Ticket status</dt>
              <dd style={detailValueStyle}>{viewingTicket.is_validated ? 'Checked in' : 'Pending'}</dd>
              {viewingTicket.validated_at && (
                <>
                  <dt style={detailLabelStyle}>Checked in at</dt>
                  <dd style={detailValueStyle}>{new Date(viewingTicket.validated_at).toLocaleString()}</dd>
                </>
              )}
              {viewingTicket.created_at && (
                <>
                  <dt style={detailLabelStyle}>Issued</dt>
                  <dd style={detailValueStyle}>{new Date(viewingTicket.created_at).toLocaleString()}</dd>
                </>
              )}
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

const layoutStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 };
const cardStyle = { background: '#fff', padding: 20, borderRadius: 10, boxShadow: '0 1px 3px #0000001a' };
const cardHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const labelStyle = { display: 'block', fontSize: 13, color: '#64748b', marginBottom: 6 };
const textareaStyle = { display: 'block', width: '100%', padding: 10, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: 12, marginBottom: 10, resize: 'vertical' };
const inputStyle = { display: 'block', width: '100%', padding: 10, marginBottom: 12, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 };
const btnStyle = { width: '100%', padding: '12px', background: '#0f172a', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const scanButtonStyle = { width: '100%', padding: '10px 12px', marginTop: 10, background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14 };
const scannerContainerStyle = { width: '100%', maxWidth: 480, margin: '14px auto 0', overflow: 'hidden', borderRadius: 8 };
const scannerErrorStyle = { marginTop: 10, color: '#991b1b', fontSize: 13 };
const resultStyle = { marginTop: 16, padding: 16, borderRadius: 8, border: '1px solid' };
const badgeStyle = { padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 };
const chipRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const chipStyle = { padding: '4px 10px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 20, cursor: 'pointer', fontSize: 12 };
const statsRowStyle = { display: 'flex', gap: 8, marginBottom: 14 };
const sectionLabelStyle = { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '12px 0 6px' };
const listStyle = { listStyle: 'none', margin: 0, padding: 0 };
const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #e2e8f0' };
const ticketMetaStyle = { fontSize: 12, color: '#64748b', marginTop: 3 };
const ticketActionsStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginLeft: 10 };
const viewBtnStyle = { padding: '5px 9px', background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const deleteBtnStyle = { padding: '5px 9px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const modalBackdropStyle = { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0f172a99' };
const ticketDetailsStyle = { width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 12px 40px #00000033' };
const closeBtnStyle = { padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc', cursor: 'pointer' };
const detailsListStyle = { display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '10px 12px', margin: '22px 0 0' };
const detailLabelStyle = { color: '#64748b', fontSize: 13, fontWeight: 600 };
const detailValueStyle = { color: '#0f172a', fontSize: 14, margin: 0, overflowWrap: 'anywhere' };
