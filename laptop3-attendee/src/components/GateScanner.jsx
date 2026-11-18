import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { API_BASE_URL, invokeRpc } from '../config/api';

const TERMINAL_ID = 'GATE_TERM_01_LAPTOP3';

export default function GateScanner({ events, tickets, onRefresh }) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [qrInput, setQrInput] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [viewingTicket, setViewingTicket] = useState(null);
  const [deletingTicketId, setDeletingTicketId] = useState(null);
  const [ticketMessage, setTicketMessage] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const videoRef = useRef(null);

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
      setScanResult({ success: false, message: 'Server is offline.' });
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
      setScanResult({ success: false, message: err.message });
    } finally {
      setBusy(false);
    }
  }, [isOnline, onRefresh, qrInput]);

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
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not supported in this browser.');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setScannerActive(true);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        rafId = requestAnimationFrame(() => tick(video, canvas, ctx));
      } catch (err) {
        if (!active) return;
        const msg = err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access in your browser settings.'
          : err?.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : (err?.message || 'Unable to start camera.');
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

  const deleteTicket = async (ticket) => {
    if (!window.confirm(`Delete ${ticket.attendee_name}'s ticket? This releases the seat and cannot be undone.`)) return;
    setDeletingTicketId(ticket.ticket_id);
    setTicketMessage(null);
    try {
      const result = await invokeRpc('DeleteTicketProcedure', { ticket_id: ticket.ticket_id });
      if (viewingTicket?.ticket_id === ticket.ticket_id) setViewingTicket(null);
      setTicketMessage({ success: result.success, message: result.message });
      await onRefresh();
    } catch (error) {
      setTicketMessage({ success: false, message: error.message });
    } finally {
      setDeletingTicketId(null);
    }
  };

  const openEvent = (ev) => {
    setSelectedEvent(ev);
    setSearch('');
    setAttendeeSearch('');
    setScanResult(null);
    setQrInput('');
    setTicketMessage(null);
    setScannerOpen(false);
  };

  const goBack = () => {
    setSelectedEvent(null);
    setScannerOpen(false);
    setScanResult(null);
  };

  // ── Event list ──────────────────────────────────────────────────────────────
  if (!selectedEvent) {
    return (
      <div>
        <div style={pageHeadingStyle}>
          <h2 style={{ margin: 0 }}>Select an Event</h2>
          <span style={{ ...badgeStyle, background: isOnline ? '#dcfce7' : '#fef3c7', color: isOnline ? '#166534' : '#92400e' }}>
            {isOnline ? '● Online' : '○ Offline'}
          </span>
        </div>
        {events.length === 0 && <p style={mutedStyle}>No events available yet.</p>}
        <div style={eventGridStyle}>
          {events.map((ev) => {
            const evTickets = tickets.filter(t => t.event_id === ev.event_id);
            const pending = evTickets.filter(t => !t.is_validated).length;
            const checkedIn = evTickets.filter(t => t.is_validated).length;
            return (
              <button key={ev.event_id} type="button" onClick={() => openEvent(ev)} style={eventCardStyle}>
                <div style={eventCardPosterStyle}>
                  {ev.image
                    ? <img src={ev.image} alt="" style={eventCardImgStyle} />
                    : <span style={eventCardPlaceholderStyle}>🎟️</span>}
                </div>
                <div style={eventCardBodyStyle}>
                  <div style={eventCardNameStyle}>{ev.name}</div>
                  {ev.date && <div style={mutedStyle}>📅 {ev.date}</div>}
                  {ev.venue && <div style={mutedStyle}>📍 {ev.venue}</div>}
                  <div style={eventCardStatsStyle}>
                    <span style={{ ...badgeStyle, background: '#fef9c3', color: '#854d0e' }}>{pending} pending</span>
                    <span style={{ ...badgeStyle, background: '#dcfce7', color: '#166534' }}>{checkedIn} checked in</span>
                  </div>
                </div>
                <div style={eventCardArrowStyle}>›</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Event detail: validator + ticket list ───────────────────────────────────
  const eventTickets = tickets.filter(t => t.event_id === selectedEvent.event_id);
  const pending = eventTickets.filter(t => !t.is_validated);
  const checkedIn = eventTickets.filter(t => t.is_validated);
  const filtered = (list) => list.filter(t =>
    !search ||
    t.attendee_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.seat_label?.toLowerCase().includes(search.toLowerCase())
  );
  const normalizedAttendeeSearch = attendeeSearch.trim().toLowerCase();
  const attendeeMatches = normalizedAttendeeSearch
    ? pending.filter(t =>
      t.attendee_name?.toLowerCase().includes(normalizedAttendeeSearch) ||
      t.seat_label?.toLowerCase().includes(normalizedAttendeeSearch) ||
      t.ticket_id?.toLowerCase().includes(normalizedAttendeeSearch)
    )
    : [];

  return (
    <div>
      <button type="button" onClick={goBack} style={backBtnStyle}>← All Events</button>

      <div style={eventBannerStyle}>
        {selectedEvent.image && <img src={selectedEvent.image} alt="" style={bannerImgStyle} />}
        <div style={bannerOverlayStyle}>
          <div style={bannerNameStyle}>{selectedEvent.name}</div>
          {selectedEvent.date && <div style={bannerMetaStyle}>📅 {selectedEvent.date}</div>}
          {selectedEvent.venue && <div style={bannerMetaStyle}>📍 {selectedEvent.venue}</div>}
        </div>
      </div>

      <div style={layoutStyle}>
        {/* Validator panel */}
        <section style={cardStyle}>
          <div style={cardHeaderStyle}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Ticket Validator</h2>
            <span style={{ ...badgeStyle, background: isOnline ? '#dcfce7' : '#fef3c7', color: isOnline ? '#166534' : '#92400e' }}>
              {isOnline ? '● Online' : '○ Offline'}
            </span>
          </div>
          <form onSubmit={validate} style={{ marginTop: 16 }}>
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
            onClick={() => { setScannerError(''); setScannerOpen(o => !o); }}
            disabled={!isOnline || busy}
            style={{ ...scanButtonStyle, opacity: !isOnline || busy ? 0.6 : 1 }}
          >
            {scannerOpen ? (scannerActive ? 'Close Scanner' : 'Starting camera…') : '📷 Scan QR ticket'}
          </button>
          {scannerOpen && <video ref={videoRef} playsInline muted style={scannerContainerStyle} />}
          {scannerError && <p role="alert" style={scannerErrorStyle}>{scannerError}</p>}
          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>Search attendee or ticket</label>
            <input
              type="search"
              value={attendeeSearch}
              onChange={(e) => setAttendeeSearch(e.target.value)}
              placeholder="Name, seat, or ticket ID"
              style={inputStyle}
            />
            {normalizedAttendeeSearch && (
              <div style={attendeeSearchResultsStyle}>
                {attendeeMatches.length === 0 ? (
                  <p style={mutedStyle}>No pending tickets found.</p>
                ) : attendeeMatches.map(t => (
                  <button
                    key={t.ticket_id}
                    type="button"
                    disabled={busy || !isOnline}
                    onClick={() => validate(null, t.qr_hash)}
                    style={attendeeMatchStyle}
                  >
                    <span>
                      <strong>{t.attendee_name}</strong>
                      <small style={attendeeMatchMetaStyle}>Seat {t.seat_label} · {t.ticket_id}</small>
                    </span>
                    <span style={validateMatchLabelStyle}>Validate</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {scanResult && (
            <div style={{ ...resultStyle, background: scanResult.success ? '#dcfce7' : '#fee2e2', borderColor: scanResult.success ? '#86efac' : '#fca5a5' }}>
              <strong>{scanResult.success ? '✓ Access Granted' : '✗ Access Denied'}</strong>
              <p style={{ margin: '6px 0 0', color: scanResult.success ? '#166534' : '#991b1b' }}>{scanResult.message}</p>
            </div>
          )}
          {pending.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={labelStyle}>Quick-fill from pending:</p>
              <div style={chipRowStyle}>
                {pending.map(t => (
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
          <div style={cardHeaderStyle}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Tickets</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ ...badgeStyle, background: '#fef9c3', color: '#854d0e' }}>{pending.length} pending</span>
              <span style={{ ...badgeStyle, background: '#dcfce7', color: '#166534' }}>{checkedIn.length} in</span>
            </div>
          </div>
          <input style={{ ...inputStyle, marginTop: 12 }} placeholder="Search by name or seat…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {ticketMessage && (
            <p style={{ color: ticketMessage.success ? '#166534' : '#991b1b', fontSize: 13 }}>{ticketMessage.message}</p>
          )}
          {eventTickets.length === 0 && <p style={mutedStyle}>No tickets for this event yet.</p>}
          {filtered(pending).length > 0 && (
            <>
              <p style={sectionLabelStyle}>Pending</p>
              <ul style={listStyle}>
                {filtered(pending).map(t => renderTicket(t, false, setViewingTicket, deleteTicket, deletingTicketId))}
              </ul>
            </>
          )}
          {filtered(checkedIn).length > 0 && (
            <>
              <p style={sectionLabelStyle}>Checked In</p>
              <ul style={listStyle}>
                {filtered(checkedIn).map(t => renderTicket(t, true, setViewingTicket, deleteTicket, deletingTicketId))}
              </ul>
            </>
          )}
        </section>
      </div>

      {viewingTicket && (
        <div style={modalBackdropStyle} onClick={() => setViewingTicket(null)}>
          <section role="dialog" aria-modal="true" style={ticketDetailsStyle} onClick={e => e.stopPropagation()}>
            <div style={cardHeaderStyle}>
              <h2 style={{ margin: 0 }}>Ticket Details</h2>
              <button type="button" onClick={() => setViewingTicket(null)} style={closeBtnStyle}>Close</button>
            </div>
            <dl style={detailsListStyle}>
              <dt style={detailLabelStyle}>Name</dt><dd style={detailValueStyle}>{viewingTicket.attendee_name}</dd>
              <dt style={detailLabelStyle}>Seat</dt><dd style={detailValueStyle}>{viewingTicket.seat_label}</dd>
              <dt style={detailLabelStyle}>Address</dt><dd style={detailValueStyle}>{viewingTicket.attendee_address || 'Not provided'}</dd>
              <dt style={detailLabelStyle}>Phone</dt><dd style={detailValueStyle}>{viewingTicket.attendee_phone || 'Not provided'}</dd>
              <dt style={detailLabelStyle}>Email</dt><dd style={detailValueStyle}>{viewingTicket.attendee_email || 'Not provided'}</dd>
              <dt style={detailLabelStyle}>Status</dt><dd style={detailValueStyle}>{viewingTicket.is_validated ? 'Checked in' : 'Pending'}</dd>
              {viewingTicket.validated_at && (<><dt style={detailLabelStyle}>Checked in at</dt><dd style={detailValueStyle}>{new Date(viewingTicket.validated_at).toLocaleString()}</dd></>)}
              {viewingTicket.created_at && (<><dt style={detailLabelStyle}>Issued</dt><dd style={detailValueStyle}>{new Date(viewingTicket.created_at).toLocaleString()}</dd></>)}
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

function renderTicket(ticket, validated, setViewingTicket, deleteTicket, deletingTicketId) {
  return (
    <li key={ticket.ticket_id} style={{ ...rowStyle, opacity: validated ? 0.8 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <strong>{ticket.attendee_name}</strong>
        <div style={ticketMetaStyle}>Seat {ticket.seat_label}</div>
      </div>
      <div style={ticketActionsStyle}>
        <span style={{ ...badgeStyle, background: validated ? '#dcfce7' : '#fef9c3', color: validated ? '#166534' : '#854d0e' }}>
          {validated ? '✓ In' : 'Pending'}
        </span>
        <button type="button" onClick={() => setViewingTicket(ticket)} style={viewBtnStyle}>View</button>
        <button type="button" onClick={() => deleteTicket(ticket)} disabled={deletingTicketId === ticket.ticket_id} style={deleteBtnStyle}>
          {deletingTicketId === ticket.ticket_id ? '…' : 'Delete'}
        </button>
      </div>
    </li>
  );
}

const pageHeadingStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 };
const eventGridStyle = { display: 'flex', flexDirection: 'column', gap: 12 };
const eventCardStyle = { display: 'flex', alignItems: 'center', gap: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 4px #0000001a', padding: 0, width: '100%' };
const eventCardPosterStyle = { width: 90, height: 90, flexShrink: 0, background: 'linear-gradient(135deg, #1e4060, #1a5c5a)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
const eventCardImgStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const eventCardPlaceholderStyle = { fontSize: 28 };
const eventCardBodyStyle = { flex: 1, padding: '12px 14px', minWidth: 0 };
const eventCardNameStyle = { fontWeight: 700, fontSize: 16, color: '#0f172a', marginBottom: 4 };
const eventCardStatsStyle = { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' };
const eventCardArrowStyle = { fontSize: 24, color: '#94a3b8', paddingRight: 14, flexShrink: 0 };
const eventBannerStyle = { position: 'relative', height: 120, borderRadius: 12, overflow: 'hidden', background: 'linear-gradient(135deg, #1e4060, #1a5c5a)', marginBottom: 20 };
const bannerImgStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const bannerOverlayStyle = { position: 'absolute', inset: 0, background: 'rgba(10,20,40,0.6)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '14px 18px' };
const bannerNameStyle = { color: '#fff', fontWeight: 800, fontSize: 20, textShadow: '0 2px 6px rgba(0,0,0,0.6)' };
const bannerMetaStyle = { color: '#cbd5e1', fontSize: 12, marginTop: 2 };
const backBtnStyle = { display: 'inline-block', marginBottom: 16, padding: '7px 14px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const layoutStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 };
const cardStyle = { background: '#fff', padding: 20, borderRadius: 10, boxShadow: '0 1px 3px #0000001a' };
const cardHeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const labelStyle = { display: 'block', fontSize: 13, color: '#64748b', marginBottom: 6 };
const textareaStyle = { display: 'block', width: '100%', padding: 10, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: 12, marginBottom: 10, resize: 'vertical' };
const inputStyle = { display: 'block', width: '100%', padding: 10, marginBottom: 12, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 };
const btnStyle = { width: '100%', padding: '12px', background: '#0f172a', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const scanButtonStyle = { width: '100%', padding: '10px 12px', marginTop: 10, background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14 };
const scannerContainerStyle = { width: '100%', maxWidth: 480, margin: '14px auto 0', display: 'block', borderRadius: 8 };
const scannerErrorStyle = { marginTop: 10, color: '#991b1b', fontSize: 13 };
const resultStyle = { marginTop: 16, padding: 16, borderRadius: 8, border: '1px solid' };
const badgeStyle = { padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 };
const chipRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const chipStyle = { padding: '4px 10px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 20, cursor: 'pointer', fontSize: 12 };
const attendeeSearchResultsStyle = { display: 'flex', flexDirection: 'column', gap: 8 };
const attendeeMatchStyle = { display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', textAlign: 'left', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', color: '#0f172a' };
const attendeeMatchMetaStyle = { display: 'block', marginTop: 3, color: '#64748b', fontSize: 11 };
const validateMatchLabelStyle = { padding: '6px 9px', borderRadius: 6, background: '#dbeafe', color: '#1e40af', fontSize: 12, fontWeight: 700, flexShrink: 0 };
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
const detailsListStyle = { display: 'grid', gridTemplateColumns: '100px minmax(0,1fr)', gap: '10px 12px', margin: '22px 0 0' };
const detailLabelStyle = { color: '#64748b', fontSize: 13, fontWeight: 600 };
const detailValueStyle = { color: '#0f172a', fontSize: 14, margin: 0, overflowWrap: 'anywhere' };
const mutedStyle = { color: '#64748b', fontSize: 13, margin: '2px 0' };
