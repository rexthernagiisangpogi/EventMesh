import React, { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { invokeRpc } from '../config/api';

const NODE_ID = 'NODE_LAPTOP4';
const walletOptions = [
  { id: 'maya', name: 'Maya', logo: '/payment-wallets/maya.svg' },
  { id: 'gcash', name: 'GCash', logo: '/payment-wallets/gcash.png' },
  { id: 'paypal', name: 'PayPal', logo: '/payment-wallets/paypal.svg' },
  { id: 'maribank', name: 'MariBank', logo: '/payment-wallets/maribank.png' },
];
function formatPrice(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
}

function moneyInCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  return Math.abs(amount * 100 - cents) <= 1e-6 ? cents : null;
}

function getSeatTicketPrice(event, seatType) {
  const tierPrice = seatType === 'VIP' ? event.vip_ticket_price : event.regular_ticket_price;
  return Number(tierPrice ?? event.ticket_price ?? 0);
}

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

  const isVipTicket = ticketEl.dataset.ticketTier === 'VIP';
  if (isVipTicket) {
    const vipBadgeY = nameY + 7;
    ctx.fillStyle = 'rgba(139,92,246,0.28)';
    ctx.beginPath();
    ctx.roundRect(24, vipBadgeY, 62, 22, 11);
    ctx.fill();
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = '#e9d5ff';
    ctx.fillText('👑 VIP', 31, vipBadgeY + 15);
  }

  // divider
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
  const dividerOffset = isVipTicket ? 39 : 14;
  ctx.beginPath(); ctx.moveTo(24, nameY + dividerOffset); ctx.lineTo(SPLIT - 24, nameY + dividerOffset); ctx.stroke();

  // detail rows
  const rows = JSON.parse(ticketEl.dataset.rows || '[]');
  const ticketRows = isVipTicket ? rows.filter(([label]) => label !== 'Event') : rows;
  let dy = nameY + (isVipTicket ? 56 : 32);
  for (const [label, value] of ticketRows) {
    ctx.font = '9px system-ui, sans-serif'; ctx.fillStyle = '#7fb8d4';
    ctx.fillText(label.toUpperCase(), 24, dy);
    ctx.font = 'bold 13px system-ui, sans-serif'; ctx.fillStyle = '#e8f4fb';
    ctx.fillText(value, 24, dy + 15, maxW); dy += isVipTicket ? 29 : 36;
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
  return seat.seat_label || `${seat.seat_type === 'VIP' ? 'V' : 'R'}${seat.seat_number}`;
}

export default function AttendeePortal({ events, seats, onRefresh }) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedSeatId, setSelectedSeatId] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '', email: '' });
  const [ticket, setTicket] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [search, setSearch] = useState('');
  const [paymentForm, setPaymentForm] = useState({
    payment_method: '',
    payment_account: '',
    payment_amount: '',
  });
  const [demoPayment, setDemoPayment] = useState(null);
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
    const heldSeat = seats.find((seat) => (
      seat.event_id === ev.event_id &&
      seat.status === 'HELD' &&
      seat.locked_by === NODE_ID
    ));
    setSelectedSeatId(heldSeat?.seat_id || null);
    setPaymentForm({
      payment_method: '',
      payment_account: '',
      payment_amount: '',
    });
    setDemoPayment(null);
    setStatus(null);
    setTicket(null);
    setForm({ name: '', address: '', phone: '', email: '' });
  };

  const goBack = () => {
    setSelectedEvent(null);
    setSelectedSeatId(null);
    setDemoPayment(null);
    setStatus(null);
    setTicket(null);
  };

  const pickSeat = async (seat) => {
    const isHeldByThisTerminal = seat.status === 'HELD' && seat.locked_by === NODE_ID;
    if (busy || (!isHeldByThisTerminal && seat.status !== 'AVAILABLE')) return;
    if (!isHeldByThisTerminal && selectedSeatId && selectedSeatId !== seat.seat_id) {
      setStatus({
        ok: false,
        message: 'Only one seat can be selected. Tap your selected seat to cancel it before choosing another.',
      });
      return;
    }
    setDemoPayment(null);
    setStatus(null);
    setBusy(true);
    try {
      const result = isHeldByThisTerminal
        ? await invokeRpc('ReleaseSeatProcedure', {
          seat_id: seat.seat_id,
          node_id: NODE_ID,
        })
        : await invokeRpc('LockSeatProcedure', {
          seat_id: seat.seat_id,
          node_id: NODE_ID,
          timeout: 180,
        });
      if (!result.success) {
        setStatus({ ok: false, message: result.message });
      } else if (isHeldByThisTerminal) {
        if (selectedSeatId === seat.seat_id) setSelectedSeatId(null);
      } else {
        setSelectedSeatId(seat.seat_id);
      }
      await onRefresh();
    } catch (e) {
      setStatus({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const simulatePayment = () => {
    const errors = {};
    if (selectedSeats.length !== 1) {
      setStatus({ ok: false, message: 'Select exactly one seat before paying.' });
      return;
    }
    if (!selectedEvent.payment_methods?.includes(paymentForm.payment_method)) {
      errors.payment_method = true;
    }
    if (!paymentForm.payment_account.trim()) {
      errors.payment_account = true;
    }
    const expectedCents = moneyInCents(getSeatTicketPrice(selectedEvent, selectedSeats[0].seat_type));
    const enteredCents = paymentForm.payment_amount.trim()
      ? moneyInCents(paymentForm.payment_amount)
      : null;
    if (expectedCents === null || enteredCents === null) {
      errors.payment_amount = true;
    } else if (enteredCents !== expectedCents) {
      errors.payment_amount = true;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      return;
    }
    setFieldErrors({});
    setDemoPayment({
      event_id: selectedEvent.event_id,
      seat_id: selectedSeats[0].seat_id,
      payment_method: paymentForm.payment_method,
      payment_account: paymentForm.payment_account.trim(),
      payment_amount_cents: enteredCents,
    });
    setStatus(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const selectedSeat = selectedSeats[0];
    if (selectedSeats.length !== 1) {
      setStatus({ ok: false, message: 'Please select one seat first.' });
      return;
    }
    const errors = {};
    if (!form.name.trim()) errors.name = true;
    if (selectedEvent.payment_required && !paymentConfirmed) {
      if (!selectedEvent.payment_methods?.includes(paymentForm.payment_method)) errors.payment_method = true;
      if (!paymentForm.payment_account.trim()) errors.payment_account = true;
      const expectedCents = moneyInCents(getSeatTicketPrice(selectedEvent, selectedSeat.seat_type));
      const enteredCents = paymentForm.payment_amount.trim() ? moneyInCents(paymentForm.payment_amount) : null;
      if (expectedCents === null || enteredCents === null || enteredCents !== expectedCents) errors.payment_amount = true;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      return;
    }
    setFieldErrors({});
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
        ...(selectedEvent.payment_required ? {
          payment_method: demoPayment.payment_method,
          payment_account: demoPayment.payment_account,
          payment_amount: demoPayment.payment_amount_cents / 100,
        } : {}),
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
  const vipSeats = eventSeats.filter((seat) => seat.seat_type === 'VIP');
  const regularSeats = eventSeats.filter((seat) => seat.seat_type !== 'VIP');
  const selectedSeats = eventSeats.filter((seat) => (
    seat.seat_id === selectedSeatId &&
    seat.status === 'HELD' &&
    seat.locked_by === NODE_ID
  ));
  const selectedSeat = selectedSeats.length === 1 ? selectedSeats[0] : null;
  const paymentRequired = selectedEvent?.payment_required === true;
  const selectedTicketPrice = selectedSeat
    ? getSeatTicketPrice(selectedEvent, selectedSeat.seat_type)
    : null;
  const enabledWallets = walletOptions.filter((wallet) => (
    selectedEvent?.payment_methods?.includes(wallet.id)
  ));
  const selectedWallet = enabledWallets.find((wallet) => (
    wallet.id === paymentForm.payment_method
  ));
  const paymentConfirmed = !paymentRequired || (
    selectedSeat &&
    demoPayment?.event_id === selectedEvent.event_id &&
    demoPayment?.seat_id === selectedSeat.seat_id &&
    demoPayment?.payment_method === paymentForm.payment_method &&
    demoPayment?.payment_account === paymentForm.payment_account.trim() &&
    demoPayment?.payment_amount_cents === moneyInCents(paymentForm.payment_amount) &&
    demoPayment?.payment_amount_cents === moneyInCents(selectedTicketPrice)
  );
  const cancelSeatSelection = async (categorySeats) => {
    if (selectedSeatId && !eventSeats.some((seat) => seat.seat_id === selectedSeatId)) {
      setSelectedSeatId(null);
      setDemoPayment(null);
      setStatus({ ok: false, message: 'Your previous seat is no longer available. Please choose again.' });
      return;
    }

    const currentSeat = categorySeats.find((seat) => seat.seat_id === selectedSeatId);
    if (currentSeat?.status === 'HELD' && currentSeat.locked_by === NODE_ID) {
      await pickSeat(currentSeat);
    } else if (currentSeat) {
      setSelectedSeatId(null);
      setDemoPayment(null);
      setStatus({ ok: false, message: 'Your seat hold is no longer active. Please choose an available seat again.' });
    }
  };

  const changeSeatSelection = async (event, categorySeats) => {
    if (selectedSeatId && !eventSeats.some((seat) => seat.seat_id === selectedSeatId)) {
      setSelectedSeatId(null);
      setDemoPayment(null);
      setStatus({ ok: false, message: 'Your previous seat is no longer available. Please choose again.' });
      return;
    }

    const seat = categorySeats.find((item) => item.seat_id === event.target.value);
    if (!seat) return;
    if (seat.seat_id === selectedSeatId) {
      await cancelSeatSelection(categorySeats);
    } else {
      await pickSeat(seat);
    }
  };

  const renderSeatDropdown = (categorySeats, categoryName) => {
    const selectionExists = eventSeats.some((seat) => seat.seat_id === selectedSeatId);
    const placeholder = categorySeats.length
      ? `Select a ${categoryName.toLowerCase()} seat`
      : `No ${categoryName.toLowerCase()} seats configured`;
    return (
      <section style={seatCategoryStyle}>
        <h4 style={seatCategoryHeadingStyle}>{categoryName} Seats</h4>
        <select
          aria-label={`Select a ${categoryName.toLowerCase()} seat`}
          style={inputStyle}
          value=""
          disabled={busy || categorySeats.length === 0}
          onChange={(event) => changeSeatSelection(event, categorySeats)}
        >
          <option value="">{placeholder}</option>
          {categorySeats.map((seat) => {
            const available = seat.status === 'AVAILABLE';
            const heldByThisTerminal = seat.status === 'HELD' && seat.locked_by === NODE_ID;
            const alreadySelected = seat.seat_id === selectedSeatId;
            const disabled = (!available && !heldByThisTerminal) ||
              (selectionExists && !alreadySelected && !heldByThisTerminal);
            return (
              <option key={seat.seat_id} value={seat.seat_id} disabled={disabled}>
                {getSeatLabel(seat)} — {alreadySelected
                  ? 'Selected'
                  : available ? 'Available' : 'Not available'}
              </option>
            );
          })}
        </select>
      </section>
    );
  };

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
                    : <span style={posterPlaceholderStyle}>No poster</span>}
                </div>
                <div style={eventSquareInnerStyle}>
                  <div style={eventNameStyle}>{ev.name}</div>
                  {ev.date && <div style={eventMetaStyle}>📅 {ev.date}</div>}
                  {ev.venue && <div style={eventMetaStyle}>📍 {ev.venue}</div>}
                  {ev.payment_required && (
                    <div style={{ ...eventMetaStyle, color: '#176c68', fontWeight: 700 }}>
                      Regular: {formatPrice(getSeatTicketPrice(ev, 'REGULAR'))} · VIP: {formatPrice(getSeatTicketPrice(ev, 'VIP'))}
                    </div>
                  )}
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
    const isVipTicket = ticket.seat_label?.startsWith('V') === true;
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
            <div style={{ fontSize: 13, color: '#2d6a5a', marginTop: 2 }}>
              {ticket.payment_status === 'SIMULATED_PAID'
                ? 'Payment complete.'
                : 'Download your digital ticket and present it at the gate.'}
            </div>
          </div>
        </div>

        {/* ── Digital Ticket Card (landscape) ── */}
        <div
          className="digital-ticket"
          ref={ticketCardRef}
          data-event-name={selectedEvent.name}
          data-ticket-tier={isVipTicket ? 'VIP' : 'REGULAR'}
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
              {isVipTicket && <div style={vipTicketBadgeStyle}>👑 VIP</div>}
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

  // ── Booking page (seat selection + personal info) ───────────────────────────
  return (
    <div>
      <button type="button" onClick={goBack} style={backBtnStyle}>← Back to Events</button>

      <div style={bookingGridStyle}>
        {/* Seat selection */}
        <div style={pageCardStyle}>
          <h3 style={{ marginTop: 0 }}>Book a Ticket</h3>
          <p style={mutedStyle}>{selectedEvent.name}</p>
          {selectedEvent.venue && <p style={eventMetaStyle}>📍 {selectedEvent.venue}</p>}
          {selectedEvent.date && <p style={eventMetaStyle}>📅 {selectedEvent.date}</p>}
          {paymentRequired && (
            <p style={{ ...eventMetaStyle, color: '#176c68', fontWeight: 700 }}>
              Regular: {formatPrice(getSeatTicketPrice(selectedEvent, 'REGULAR'))} · VIP: {formatPrice(getSeatTicketPrice(selectedEvent, 'VIP'))}
            </p>
          )}

          {renderSeatDropdown(vipSeats, 'VIP')}
          {renderSeatDropdown(regularSeats, 'Regular')}
          {eventSeats.length === 0 && <p style={mutedStyle}>No seats configured yet.</p>}
          {selectedSeats.length > 0 && (
            <div style={selectedSeatBannerStyle}>
              ✓ Seat {getSeatLabel(selectedSeats[0])} selected
            </div>
          )}
        </div>

        {/* Personal info + submit */}
        <div style={pageCardStyle}>
          <h3 style={{ marginTop: 0 }}>Your Information</h3>
          {selectedSeats.length === 1
            ? <p style={{ ...mutedStyle, marginBottom: 16 }}>Seat <strong>{getSeatLabel(selectedSeat)}</strong> selected. Fill in your details to confirm.</p>
            : <p style={{ ...mutedStyle, marginBottom: 16 }}>Select one seat on the left first.</p>
          }
          <form onSubmit={submit}>
            <input style={{ ...inputStyle, ...(fieldErrors.name ? { borderColor: '#ef4444' } : {}) }} placeholder="Full name *" required maxLength={200} value={form.name} onChange={(e) => { setFieldErrors((prev) => ({ ...prev, name: false })); set('name')(e); }} />
            <input style={inputStyle} placeholder="Address" maxLength={300} value={form.address} onChange={set('address')} />
            <input style={inputStyle} placeholder="Phone number" type="tel" maxLength={30} value={form.phone} onChange={set('phone')} />
            <input style={inputStyle} placeholder="Email address" type="email" maxLength={200} value={form.email} onChange={set('email')} />
            {paymentRequired && (
              <section style={payHereStyle}>
                <h3 style={{ margin: '0 0 6px' }}>Pay here</h3>
                <p style={paymentDueStyle}>
                  Amount for a ticket:{' '}
                  <strong>{selectedTicketPrice === null
                    ? 'Select a seat'
                    : formatPrice(selectedTicketPrice)}
                  </strong>
                </p>
                <label style={paymentLabelStyle} htmlFor="demo-payment-method">E-wallet</label>
                <select
                  id="demo-payment-method"
                  style={{ ...inputStyle, ...(fieldErrors.payment_method ? { borderColor: '#ef4444' } : {}) }}
                  required
                  value={paymentForm.payment_method}
                  disabled={enabledWallets.length === 0}
                  onChange={(e) => {
                    setPaymentForm((previous) => ({
                      ...previous,
                      payment_method: e.target.value,
                      payment_account: '',
                    }));
                    setDemoPayment(null);
                    setStatus(null);
                    setFieldErrors((prev) => ({ ...prev, payment_method: false }));
                  }}
                >
                  <option value="">Choose an E-wallet</option>
                  {enabledWallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                  ))}
                </select>
                {enabledWallets.length === 0 && (
                  <p style={paymentErrorStyle}>The operator has not configured an E-wallet for this event.</p>
                )}
                {selectedWallet && (
                  <>
                    <div style={selectedWalletStyle}>
                      <img src={selectedWallet.logo} alt="" style={walletLogoStyle} />
                      <span>{selectedWallet.name} selected</span>
                    </div>
                    <label style={paymentLabelStyle} htmlFor="demo-payment-account">E-wallet number or account</label>
                    <input
                      id="demo-payment-account"
                      style={{ ...inputStyle, ...(fieldErrors.payment_account ? { borderColor: '#ef4444' } : {}) }}
                      type="text"
                      inputMode="tel"
                      autoComplete="off"
                      maxLength={100}
                      required
                      placeholder="Enter account or number"
                      value={paymentForm.payment_account}
                      onChange={(e) => {
                        setPaymentForm((previous) => ({ ...previous, payment_account: e.target.value }));
                        setDemoPayment(null);
                        setStatus(null);
                        setFieldErrors((prev) => ({ ...prev, payment_account: false }));
                      }}
                    />
                    <label style={paymentLabelStyle} htmlFor="demo-payment-amount">Amount paid (PHP)</label>
                    <input
                      id="demo-payment-amount"
                      style={{ ...inputStyle, ...(fieldErrors.payment_amount ? { borderColor: '#ef4444' } : {}) }}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={paymentForm.payment_amount}
                      onChange={(e) => {
                        setPaymentForm((previous) => ({ ...previous, payment_amount: e.target.value }));
                        setDemoPayment(null);
                        setStatus(null);
                        setFieldErrors((prev) => ({ ...prev, payment_amount: false }));
                      }}
                    />
                    <button
                      type="button"
                      onClick={simulatePayment}
                      disabled={busy || paymentConfirmed}
                      style={{ ...btnStyle, width: '100%', opacity: busy || paymentConfirmed ? 0.65 : 1 }}
                    >
                      {paymentConfirmed ? 'Payment complete' : 'Confirm payment'}
                    </button>
                  </>
                )}
              </section>
            )}
            <button
              type="submit"
              disabled={busy || selectedSeats.length !== 1 || (paymentRequired && !paymentConfirmed)}
              style={{ ...btnStyle, width: '100%', opacity: busy || selectedSeats.length !== 1 || (paymentRequired && !paymentConfirmed) ? 0.5 : 1 }}
            >
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
const seatCategoryStyle = { marginTop: 16 };
const seatCategoryHeadingStyle = { margin: 0, color: '#334155', fontSize: 13, fontWeight: 700 };
const selectedSeatBannerStyle = { marginTop: 12, padding: '8px 12px', background: '#dff4ef', color: '#176c68', borderRadius: 6, fontWeight: 600, fontSize: 13 };
const payHereStyle = { padding: 14, margin: '8px 0 16px', border: '1px solid #b9dce1', borderRadius: 8, background: '#f5fbfc' };
const paymentDueStyle = { margin: '0 0 12px', color: '#176c68', fontSize: 14 };
const paymentErrorStyle = { color: '#991b1b', fontSize: 13, margin: '12px 0 0' };
const selectedWalletStyle = { display: 'flex', alignItems: 'center', gap: 8, margin: '-4px 0 12px', color: '#475569', fontSize: 12, fontWeight: 600 };
const walletLogoStyle = { width: 30, height: 24, objectFit: 'contain' };
const paymentLabelStyle = { display: 'block', marginBottom: 5, color: '#475569', fontSize: 12, fontWeight: 600 };
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
const vipTicketBadgeStyle = { display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', padding: '4px 11px', background: 'rgba(139,92,246,0.28)', border: '1px solid rgba(196,181,253,0.55)', borderRadius: 20, color: '#e9d5ff', fontSize: 11, fontWeight: 800, letterSpacing: '0.5px' };
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
