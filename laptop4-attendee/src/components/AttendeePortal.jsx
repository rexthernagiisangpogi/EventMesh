import React, { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { invokeRpc } from '../config/api';

const NODE_ID = 'NODE_LAPTOP4';

async function buildTicketCanvas(ticketEl, qrCanvasEl) {
  const W = 800, H = 300;
  const SPLIT = 530;
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2;
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);

  // background: poster or gradient
  const posterImg = ticketEl.querySelector('img[data-ticket-poster]');
  ctx.save();
  ctx.roundRect(0, 0, W, H, 18); ctx.clip();
  if (posterImg && posterImg.complete) {
    ctx.drawImage(posterImg, 0, 0, W, H);
  } else {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0f2236'); bg.addColorStop(1, '#1a4a5a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(8,20,36,0.72)'; ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // top accent bar
  const stripe = ctx.createLinearGradient(0, 0, W, 0);
  stripe.addColorStop(0, '#38bdf8'); stripe.addColorStop(1, '#34d399');
  ctx.fillStyle = stripe; ctx.fillRect(0, 0, W, 4);

  // event name (word-wrap)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 10;
  const evName = ticketEl.dataset.eventName || '';
  const maxW = SPLIT - 48;
  let words = evName.split(' '), line = '', nameY = 68;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, 24, nameY); line = w; nameY += 30;
    } else { line = test; }
  }
  ctx.fillText(line, 24, nameY);
  ctx.shadowBlur = 0;

  // divider
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(24, nameY + 14); ctx.lineTo(SPLIT - 24, nameY + 14); ctx.stroke();

  // detail rows
  const rows = JSON.parse(ticketEl.dataset.rows || '[]');
  let dy = nameY + 32;
  for (const [label, value] of rows) {
    ctx.font = '9px system-ui, sans-serif'; ctx.fillStyle = '#7fb8d4';
    ctx.fillText(label.toUpperCase(), 24, dy);
    ctx.font = 'bold 13px system-ui, sans-serif'; ctx.fillStyle = '#e8f4fb';
    ctx.fillText(value, 24, dy + 15, maxW); dy += 36;
  }

  // ticket id
  ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText(ticketEl.dataset.ticketId || '', 24, H - 12, SPLIT - 48);

  // vertical tear line
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(SPLIT, 14); ctx.lineTo(SPLIT, H - 14); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(8,20,36,0.9)';
  ctx.beginPath(); ctx.arc(SPLIT, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(SPLIT, H, 12, 0, Math.PI * 2); ctx.fill();

  // QR code
  const qrSize = 160;
  const qrX = SPLIT + (W - SPLIT - qrSize) / 2;
  const qrY = (H - qrSize) / 2 - 12;
  ctx.fillStyle = '#fff'; ctx.roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 10); ctx.fill();
  ctx.drawImage(qrCanvasEl, qrX, qrY, qrSize, qrSize);
  ctx.font = '9px system-ui, sans-serif'; ctx.fillStyle = '#7fb8d4';
  ctx.textAlign = 'center';
  ctx.fillText('Scan at the gate · Keep this ticket private', SPLIT + (W - SPLIT) / 2, qrY + qrSize + 24);
  ctx.textAlign = 'left';

  return c;
}

function getSeatLabel(seat) {
  return seat.seat_label || `S${seat.seat_number}`;
}

export default function AttendeePortal({ events, seats, onRefresh }) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '', email: '' });
  const [ticket, setTicket] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const qrRef = useRef(null);
  const ticketCardRef = useRef(null);

  const downloadTicket = async () => {
    const qrCanvas = qrRef.current?.querySelector('canvas');
    const ticketEl = ticketCardRef.current;
    if (!qrCanvas || !ticketEl) {
      setStatus({ ok: false, message: 'Unable to prepare the ticket for download.' });
      return;
    }
    try {
      const canvas = await buildTicketCanvas(ticketEl, qrCanvas);
      const link = document.createElement('a');
      link.download = `eventmesh-ticket-${ticket.ticket_id}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      setStatus({ ok: false, message: 'Download failed: ' + err.message });
    }
  };

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const openEvent = (ev) => {
    setSelectedEvent(ev);
    setSelectedSeat(null);
    setStatus(null);
    setTicket(null);
    setForm({ name: '', address: '', phone: '', email: '' });
  };

  const goBack = () => {
    setSelectedEvent(null);
    setSelectedSeat(null);
    setStatus(null);
    setTicket(null);
  };

  const pickSeat = async (seat) => {
    if (busy || seat.status !== 'AVAILABLE') return;
    setStatus(null);
    setBusy(true);
    try {
      const result = await invokeRpc('LockSeatProcedure', {
        seat_id: seat.seat_id,
        node_id: NODE_ID,
        timeout: 180,
      });
      if (result.success) {
        setSelectedSeat(seat);
      } else {
        setStatus({ ok: false, message: result.message });
      }
      await onRefresh();
    } catch (e) {
      setStatus({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!selectedSeat) {
      setStatus({ ok: false, message: 'Please select a seat first.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await invokeRpc('BookSeatProcedure', {
        seat_id: selectedSeat.seat_id,
        node_id: NODE_ID,
        attendee_name: form.name.trim(),
        attendee_address: form.address.trim(),
        attendee_phone: form.phone.trim(),
        attendee_email: form.email.trim(),
      });
      if (result.success) {
        setTicket(result.ticket);
        await onRefresh();
      } else {
        setStatus({ ok: false, message: result.message });
      }
    } catch (e) {
      setStatus({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const eventSeats = seats.filter((s) => s.event_id === selectedEvent?.event_id);

  // ── Event list ──────────────────────────────────────────────────────────────
  if (!selectedEvent) {
    const normalizedSearch = search.trim().toLowerCase();
    const visibleEvents = events.filter((ev) => (
      !normalizedSearch ||
      [ev.name, ev.venue, ev.date, ev.description]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedSearch))
    ));

    return (
      <div>
        <section className="event-intro" style={introStyle}>
          <div style={eyebrowStyle}><span style={eyebrowDotStyle} /> CHOOSE · BOOK · EXPERIENCE</div>
          <div className="event-intro-content" style={introContentStyle}>
            <div>
              <h1 className="event-intro-heading" style={heroHeadingStyle}>Find your next great moment</h1>
              <p style={introCopyStyle}>Explore campus events, select an available seat, and confirm your booking in just a few steps.</p>
            </div>
            <div className="event-count" style={eventCountStyle}>
              <strong style={eventCountNumberStyle}>{events.length}</strong>
              <span>{events.length === 1 ? 'event to explore' : 'events to explore'}</span>
            </div>
          </div>
          <div style={sectionHeadingStyle}>
            <div>
              <h2 style={availableHeadingStyle}>Available Events</h2>
              <p style={sectionCopyStyle}>Pick something you’ll be excited to experience.</p>
            </div>
            <label className="event-search" style={searchStyle}>
              <span aria-hidden="true">⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events"
                aria-label="Search events"
                style={searchInputStyle}
              />
            </label>
          </div>
        </section>
        {events.length === 0 && <p style={mutedStyle}>No events available yet. Check back soon.</p>}
        {events.length > 0 && visibleEvents.length === 0 && <p style={mutedStyle}>No events match “{search.trim()}”.</p>}
        <div style={gridStyle}>
          {visibleEvents.map((ev) => {
            const evSeats = seats.filter((s) => s.event_id === ev.event_id);
            const avail = evSeats.filter((s) => s.status === 'AVAILABLE').length;
            const soldOut = avail === 0;
            return (
              <button
                key={ev.event_id}
                type="button"
                onClick={() => !soldOut && openEvent(ev)}
                disabled={soldOut}
                className="event-card"
                style={{ ...eventSquareStyle, opacity: soldOut ? 0.65 : 1, cursor: soldOut ? 'not-allowed' : 'pointer' }}
              >
                <div style={posterContainerStyle}>
                  {ev.image
                    ? <img src={ev.image} alt={`Poster for ${ev.name}`} style={posterStyle} />
                    : <span style={posterPlaceholderStyle}>Event poster</span>}
                </div>
                <div style={eventSquareInnerStyle}>
                  <div style={eventNameStyle}>{ev.name}</div>
                  {ev.date && <div style={eventMetaStyle}>📅 {ev.date}</div>}
                  {ev.venue && <div style={eventMetaStyle}>📍 {ev.venue}</div>}
                  {ev.description && <div style={eventDescStyle}>{ev.description}</div>}
                  <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                    <span style={{ ...availBadgeStyle, background: soldOut ? '#fff0e8' : '#fff1b8', color: soldOut ? '#a4473d' : '#6c510a' }}>
                      <span style={availabilityDotStyle(soldOut)} />
                      {soldOut ? 'Sold Out' : `${avail} seat${avail !== 1 ? 's' : ''} available`}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Ticket confirmation ─────────────────────────────────────────────────────
  if (ticket) {
    const detailRows = [
      ['Name', ticket.attendee_name],
      ['Event', selectedEvent.name],
      ['Seat', ticket.seat_label],
      ...(selectedEvent.date ? [['Date', selectedEvent.date]] : []),
      ...(selectedEvent.venue ? [['Venue', selectedEvent.venue]] : []),
    ];
    return (
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={successBannerStyle}>
          <span style={successIconStyle}>✓</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#0f4c3a' }}>Booking Confirmed!</div>
            <div style={{ fontSize: 13, color: '#2d6a5a', marginTop: 2 }}>Download your digital ticket and present it at the gate.</div>
          </div>
        </div>

        {/* ── Digital Ticket Card (landscape) ── */}
        <div
          className="digital-ticket"
          ref={ticketCardRef}
          data-event-name={selectedEvent.name}
          data-ticket-id={ticket.ticket_id}
          data-rows={JSON.stringify(detailRows)}
          style={digitalTicketStyle}
        >
          {/* Poster as full background */}
          {selectedEvent.image && (
            <img data-ticket-poster="1" src={selectedEvent.image} alt="" style={ticketBgImgStyle} />
          )}
          <div style={ticketBgOverlayStyle} />

          {/* Top accent bar */}
          <div style={ticketAccentBarStyle} />

          {/* Landscape body: left info | tear line | right QR */}
          <div style={ticketLandscapeBodyStyle}>
            {/* Left panel */}
            <div style={ticketLeftPanelStyle}>
              <div style={ticketEventNameStyle}>{selectedEvent.name}</div>
              <div style={ticketDetailsDividerStyle} />
              {detailRows.map(([label, value]) => (
                <div key={label} style={ticketDetailItemStyle}>
                  <div style={ticketDetailLabelStyle}>{label}</div>
                  <div style={ticketDetailValueStyle}>{value}</div>
                </div>
              ))}
              <div style={ticketIdStyle}>{ticket.ticket_id}</div>
            </div>

            {/* Vertical tear line */}
            <div style={vTearLineWrapStyle}>
              <div style={vTearCircleTopStyle} />
              <div style={vTearLineDashStyle} />
              <div style={vTearCircleBottomStyle} />
            </div>

            {/* Right panel: QR */}
            <div style={ticketRightPanelStyle}>
              <div ref={qrRef} style={ticketQrBoxStyle}>
                <QRCodeCanvas value={ticket.qr_hash} size={150} level="H" includeMargin />
              </div>
              <div style={ticketQrHintStyle}>Scan at the gate</div>
              <div style={ticketQrHintStyle}>Keep this ticket private</div>
            </div>
          </div>
        </div>

        <div className="booking-actions" style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={downloadTicket} style={{ ...btnStyle, flex: 1 }}>
            ⬇ Download Ticket
          </button>
          <button type="button" onClick={goBack} style={{ ...btnStyle, flex: 1, background: 'linear-gradient(110deg, #1e3a52, #1a5c5a)' }}>
            ← Back to Events
          </button>
        </div>
        {status && !status.ok && <p style={{ color: '#991b1b', fontSize: 13, marginTop: 8 }}>{status.message}</p>}
      </div>
    );
  }

  // ── Booking page (seat map + personal info) ─────────────────────────────────
  return (
    <div>
      <button type="button" onClick={goBack} style={backBtnStyle}>← Back to Events</button>

      <div style={bookingGridStyle}>
        {/* Seat map */}
        <div style={pageCardStyle}>
          <h3 style={{ marginTop: 0 }}>Select a Seat</h3>
          <p style={mutedStyle}>{selectedEvent.name}</p>
          {selectedEvent.venue && <p style={eventMetaStyle}>📍 {selectedEvent.venue}</p>}
          {selectedEvent.date && <p style={eventMetaStyle}>📅 {selectedEvent.date}</p>}

          {status && !status.ok && <p style={{ color: '#991b1b', fontSize: 13 }}>{status.message}</p>}

          <div className="seat-grid" style={seatGridStyle}>
            {eventSeats.map((seat) => {
              const mine = seat.status === 'HELD' && seat.locked_by === NODE_ID;
              const isSelected = selectedSeat?.seat_id === seat.seat_id;
              const color = isSelected ? '#aa8215'
                : seat.status === 'BOOKED' ? '#ef4444'
                : mine ? '#c29a29'
                : seat.status === 'HELD' ? '#f59e0b'
                : '#22c55e';
              return (
                <button
                  key={seat.seat_id}
                  type="button"
                  onClick={() => pickSeat(seat)}
                  disabled={busy || seat.status !== 'AVAILABLE'}
                  title={seat.status}
                  style={{
                    ...seatBtnStyle,
                    backgroundColor: color,
                    opacity: seat.status !== 'AVAILABLE' ? 0.5 : 1,
                    outline: isSelected ? '3px solid #80610e' : 'none',
                  }}
                >
                  {getSeatLabel(seat)}
                </button>
              );
            })}
            {eventSeats.length === 0 && <p style={mutedStyle}>No seats configured yet.</p>}
          </div>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>
            Green: available · Amber: held · Red: booked
          </p>
          {selectedSeat && (
            <div style={selectedSeatBannerStyle}>
              ✓ Seat {getSeatLabel(selectedSeat)} selected
            </div>
          )}
        </div>

        {/* Personal info + submit */}
        <div style={pageCardStyle}>
          <h3 style={{ marginTop: 0 }}>Your Information</h3>
          {selectedSeat
            ? <p style={{ ...mutedStyle, marginBottom: 16 }}>Seat <strong>{getSeatLabel(selectedSeat)}</strong> selected. Fill in your details to confirm.</p>
            : <p style={{ ...mutedStyle, marginBottom: 16 }}>Select a seat on the left first.</p>
          }
          <form onSubmit={submit}>
            <input style={inputStyle} placeholder="Full name *" required maxLength={200} value={form.name} onChange={set('name')} />
            <input style={inputStyle} placeholder="Address" maxLength={300} value={form.address} onChange={set('address')} />
            <input style={inputStyle} placeholder="Phone number" type="tel" maxLength={30} value={form.phone} onChange={set('phone')} />
            <input style={inputStyle} placeholder="Email address" type="email" maxLength={200} value={form.email} onChange={set('email')} />
            <button type="submit" disabled={busy || !selectedSeat} style={{ ...btnStyle, width: '100%', opacity: !selectedSeat ? 0.5 : 1 }}>
              {busy ? 'Booking…' : 'Submit Booking →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const heroHeadingStyle = { maxWidth: 560, margin: '8px 0 16px', color: '#20334a', fontSize: 'clamp(30px, 5vw, 48px)', lineHeight: 1.08, letterSpacing: '-1.5px', fontWeight: 800 };
const mutedStyle = { color: '#596c7f', fontSize: 14, margin: '0 0 4px' };
const introStyle = { marginBottom: 30, padding: '30px 34px 25px', border: '1px solid #c9dde8', borderRadius: 24, background: 'linear-gradient(120deg, rgba(250, 253, 255, 0.94), rgba(236, 248, 247, 0.92))', boxShadow: '0 16px 40px #17395124', overflow: 'hidden', position: 'relative' };
const eyebrowStyle = { display: 'flex', alignItems: 'center', gap: 8, color: '#287f92', fontSize: 11, fontWeight: 800, letterSpacing: '1.6px' };
const eyebrowDotStyle = { width: 7, height: 7, borderRadius: '50%', background: '#ef7967', boxShadow: '0 0 0 4px #ef796722' };
const introContentStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 };
const introCopyStyle = { maxWidth: 550, color: '#52687b', fontSize: 15, lineHeight: 1.7, margin: 0 };
const eventCountStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 104, height: 104, borderRadius: '50%', background: 'linear-gradient(145deg, #d9f3f1, #dceafa)', color: '#28748b', fontSize: 11, fontWeight: 600, textAlign: 'center', boxShadow: 'inset 0 0 0 1px #fff' };
const eventCountNumberStyle = { color: '#233e5a', fontSize: 31, lineHeight: 1.1 };
const sectionHeadingStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #d5e5ea', marginTop: 25, paddingTop: 19 };
const availableHeadingStyle = { margin: 0, color: '#20334a', fontSize: 21, letterSpacing: '-0.4px' };
const sectionCopyStyle = { color: '#647a8b', fontSize: 13, margin: '4px 0 0' };
const sparkleStyle = { color: '#e47a67', fontSize: 25 };
const searchStyle = { display: 'flex', alignItems: 'center', gap: 8, width: 220, padding: '8px 12px', borderRadius: 12, border: '1px solid #c9dde8', background: '#f9fcfd', color: '#658194', boxSizing: 'border-box', transition: 'all 0.2s ease' };
const searchInputStyle = { width: '100%', minWidth: 0, border: 0, outline: 0, background: 'transparent', color: '#20334a', fontSize: 13 };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(245px, 1fr))', gap: 20 };
const eventSquareStyle = { display: 'flex', flexDirection: 'column', height: 400, background: 'rgba(250, 253, 255, 0.96)', border: '1px solid #c7dce8', borderRadius: 18, padding: 0, textAlign: 'left', boxShadow: '0 8px 22px #17395120', transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease', overflow: 'hidden' };
const posterContainerStyle = { height: '52%', flexShrink: 0, background: 'linear-gradient(135deg, #d8ebf3, #d8f1ed)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
const posterStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const posterPlaceholderStyle = { color: '#28768d', fontSize: 13, fontWeight: 700, letterSpacing: '0.5px' };
const eventSquareInnerStyle = { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '18px 20px 20px', background: 'linear-gradient(180deg, #fbfdff 0%, #f0f8fa 100%)' };
const eventNameStyle = { fontSize: 19, fontWeight: 750, color: '#20334a', marginBottom: 8, letterSpacing: '-0.3px' };
const eventMetaStyle = { fontSize: 12, color: '#596f83', margin: '3px 0' };
const eventDescStyle = { fontSize: 12, color: '#71869a', marginTop: 7, overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 };
const availBadgeStyle = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 20, fontSize: 11, fontWeight: 700 };
const availabilityDotStyle = (soldOut) => ({ width: 6, height: 6, borderRadius: '50%', background: soldOut ? '#c5503d' : '#347f9b' });
const pageCardStyle = { background: 'rgba(250, 253, 255, 0.96)', padding: 24, borderRadius: 16, border: '1px solid #c7dce8', boxShadow: '0 12px 30px #17395120' };
const bookingGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 };
const backBtnStyle = { display: 'inline-block', marginBottom: 16, padding: '7px 16px', background: '#e6f3f7', color: '#285d77', border: '1px solid #bad5e1', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const seatGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))', gap: 6, marginTop: 12 };
const seatBtnStyle = { padding: '8px 4px', color: '#fff', border: 0, borderRadius: 6, fontWeight: 700, fontSize: 11, cursor: 'pointer' };
const selectedSeatBannerStyle = { marginTop: 12, padding: '8px 12px', background: '#dff4ef', color: '#176c68', borderRadius: 6, fontWeight: 600, fontSize: 13 };
const inputStyle = { display: 'block', width: '100%', padding: 11, marginBottom: 10, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #bfd4e1', fontSize: 14, background: '#fbfdff', color: '#20334a' };
const btnStyle = { padding: '12px 20px', background: 'linear-gradient(110deg, #3474b5, #258f9a)', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14 };
const successBannerStyle = { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: 'linear-gradient(110deg, #d1fae5, #ccfbf1)', border: '1px solid #6ee7b7', borderRadius: 12, marginBottom: 18 };
const successIconStyle = { width: 44, height: 44, background: '#10b981', color: '#fff', borderRadius: '50%', fontSize: 22, lineHeight: '44px', textAlign: 'center', fontWeight: 700, flexShrink: 0 };
const digitalTicketStyle = { position: 'relative', borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 60px rgba(10,28,50,0.6), 0 0 0 1px rgba(255,255,255,0.07)', color: '#fff', background: 'linear-gradient(135deg, #0f2236, #1a4a5a)' };
const ticketBgImgStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', zIndex: 0 };
const ticketBgOverlayStyle = { position: 'absolute', inset: 0, background: 'rgba(8,20,36,0.72)', zIndex: 1 };
const ticketAccentBarStyle = { position: 'relative', zIndex: 2, height: 4, background: 'linear-gradient(90deg, #38bdf8, #34d399)' };
const ticketLandscapeBodyStyle = { position: 'relative', zIndex: 2, display: 'flex', alignItems: 'stretch', minHeight: 220 };
const ticketLeftPanelStyle = { flex: '1 1 0', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };
const admitBadgeStyle = { display: 'inline-block', alignSelf: 'flex-start', padding: '3px 10px', background: 'rgba(56,189,248,0.22)', border: '1px solid rgba(56,189,248,0.5)', borderRadius: 20, fontSize: 10, fontWeight: 800, letterSpacing: '1.5px', color: '#7dd3fc' };
const ticketEventNameStyle = { fontSize: 'clamp(16px, 3vw, 22px)', fontWeight: 800, letterSpacing: '-0.3px', textShadow: '0 2px 8px rgba(0,0,0,0.7)', lineHeight: 1.2, margin: '2px 0 4px' };
const ticketDetailsDividerStyle = { height: 1, background: 'rgba(255,255,255,0.15)', margin: '2px 0 4px' };
const ticketDetailItemStyle = { display: 'flex', flexDirection: 'column', gap: 1 };
const ticketDetailLabelStyle = { fontSize: 9, color: '#7fb8d4', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' };
const ticketDetailValueStyle = { fontSize: 14, fontWeight: 700, color: '#e8f4fb' };
const ticketIdStyle = { marginTop: 'auto', fontSize: 8, color: 'rgba(255,255,255,0.22)', fontFamily: 'monospace', wordBreak: 'break-all' };
const vTearLineWrapStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 };
const vTearCircleTopStyle = { width: 18, height: 18, borderRadius: '50%', background: 'rgba(8,20,36,0.9)', flexShrink: 0, marginTop: -9 };
const vTearLineDashStyle = { flex: 1, borderLeft: '2px dashed rgba(255,255,255,0.2)', margin: '4px 0' };
const vTearCircleBottomStyle = { width: 18, height: 18, borderRadius: '50%', background: 'rgba(8,20,36,0.9)', flexShrink: 0, marginBottom: -9 };
const ticketRightPanelStyle = { flexShrink: 0, width: 'clamp(160px, 28%, 200px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px' };
const ticketQrBoxStyle = { background: '#fff', padding: 8, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' };
const ticketQrHintStyle = { fontSize: 10, color: '#7fb8d4', textAlign: 'center', lineHeight: 1.4 };
