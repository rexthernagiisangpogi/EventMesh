import React, { useState } from 'react';
import { invokeRpc } from '../config/api';

const walletOptions = [
  { id: 'maya', name: 'Maya', logo: '/payment-wallets/maya.svg' },
  { id: 'gcash', name: 'GCash', logo: '/payment-wallets/gcash.png' },
  { id: 'paypal', name: 'PayPal', logo: '/payment-wallets/paypal.svg' },
  { id: 'maribank', name: 'MariBank', logo: '/payment-wallets/maribank.png' },
];
const walletNames = Object.fromEntries(walletOptions.map(({ id, name }) => [id, name]));
const blank = {
  name: '',
  description: '',
  venue: '',
  date: '',
  regular_seats: 50,
  vip_seats: 0,
  image: '',
  payment_required: false,
  regular_ticket_price: '0',
  vip_ticket_price: '0',
  payment_methods: [],
};

function formatPrice(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
}

function getSeatLabel(seat) {
  return seat.seat_label || `${seat.seat_type === 'VIP' ? 'V' : 'R'}${seat.seat_number}`;
}

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function TicketingTerminal({ events, seats, tickets, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const set = (f) => (e) => {
    setStatus(null);
    setForm((p) => ({ ...p, [f]: e.target.value }));
  };

  const openCreate = () => { setEditing(null); setForm(blank); setStatus(null); setShowForm(true); };
  const openEdit = (ev) => {
    const evSeats = seats.filter((s) => s.event_id === ev.event_id);
    const regularSeats = evSeats.filter((seat) => seat.seat_type !== 'VIP').length;
    const vipSeats = evSeats.filter((seat) => seat.seat_type === 'VIP').length;
    setEditing(ev.event_id);
    setForm({
      ...blank,
      name: ev.name,
      description: ev.description || '',
      venue: ev.venue || '',
      date: ev.date || '',
      regular_seats: regularSeats,
      vip_seats: vipSeats,
      image: ev.image || '',
      payment_required: ev.payment_required === true,
      regular_ticket_price: String(ev.regular_ticket_price ?? ev.ticket_price ?? 0),
      vip_ticket_price: String(ev.vip_ticket_price ?? ev.ticket_price ?? 0),
      payment_methods: Array.isArray(ev.payment_methods) ? ev.payment_methods : [],
    });
    setStatus(null);
    setShowForm(true);
  };
  const cancel = () => { setShowForm(false); setEditing(null); setForm(blank); setStatus(null); };

  const submit = async (e) => {
    e.preventDefault();
    const regularSeats = Number(form.regular_seats);
    const vipSeats = Number(form.vip_seats);
    if (!Number.isInteger(regularSeats) || regularSeats < 0 ||
        !Number.isInteger(vipSeats) || vipSeats < 0 ||
        regularSeats + vipSeats < 1 || regularSeats + vipSeats > 2500) {
      setStatus({ ok: false, message: 'Enter between 1 and 2,500 total seats.' });
      return;
    }
    if (form.payment_required &&
        (Number(form.regular_ticket_price) <= 0 || Number(form.vip_ticket_price) <= 0)) {
      setStatus({ ok: false, message: 'Enter both regular and VIP ticket prices greater than zero.' });
      return;
    }
    if (form.payment_required && form.payment_methods.length === 0) {
      setStatus({ ok: false, message: 'Select at least one eWallet for this event.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      if (editing) {
      const eventResult = await invokeRpc('UpdateEventProcedure', {
          event_id: editing,
        name: form.name,
        description: form.description,
        venue: form.venue,
        date: form.date,
        image: form.image,
        regular_seats: regularSeats,
        vip_seats: vipSeats,
        payment_required: form.payment_required,
        regular_ticket_price: Number(form.regular_ticket_price || 0),
        vip_ticket_price: Number(form.vip_ticket_price || 0),
        payment_methods: form.payment_methods,
      });
      if (!eventResult.success) {
        setStatus({ ok: false, message: eventResult.message });
        return;
      }
      if (!Number.isInteger(eventResult.created_count)) {
        setStatus({
          ok: false,
          message: 'Laptop 1 updated the event but did not confirm the seat count. Update and restart Laptop 1’s server before editing seats.',
        });
        await onRefresh();
        return;
      }
      setStatus({ ok: true, message: 'Saved' });
      await onRefresh();
      return;
    }

      const eventResult = await invokeRpc('CreateEventProcedure', {
        name: form.name, description: form.description,
        venue: form.venue, date: form.date, image: form.image,
        regular_seats: regularSeats,
        vip_seats: vipSeats,
        payment_required: form.payment_required,
        regular_ticket_price: Number(form.regular_ticket_price || 0),
        vip_ticket_price: Number(form.vip_ticket_price || 0),
        payment_methods: form.payment_methods,
      });

      if (!eventResult.success) {
        setStatus({ ok: false, message: eventResult.message });
        return;
      }

      if (eventResult.created_count !== regularSeats + vipSeats) {
        let cleanupMessage = '';
        try {
          const cleanup = await invokeRpc('DeleteEventProcedure', { event_id: eventResult.event_id });
          cleanupMessage = cleanup.success
            ? ' The incomplete event was removed.'
            : ` Cleanup also failed: ${cleanup.message}`;
        } catch (cleanupError) {
          cleanupMessage = ` The incomplete event may remain; delete event ${eventResult.event_id} from Laptop 2. Cleanup error: ${cleanupError.message}`;
        }
        setStatus({
          ok: false,
          message: `Laptop 1's server is outdated and did not create the requested seats. Update/restart the Laptop 1 server, then try again.${cleanupMessage}`,
        });
        return;
      }

      setStatus({ ok: true, message: `Event created with ${regularSeats + vipSeats} seats.` });
      await onRefresh();
      cancel();
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const deleteEvent = async (event_id, name) => {
    if (!window.confirm(`Delete event "${name}"?`)) return;
    setBusy(true);
    try {
      const result = await invokeRpc('DeleteEventProcedure', { event_id });
      setStatus({ ok: result.success, message: result.message });
      if (result.success) { await onRefresh(); if (expandedId === event_id) setExpandedId(null); }
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* Header row */}
      <div style={headerRowStyle}>
        <h2 style={{ margin: 0 }}>Events</h2>
        {!showForm && (
          <button type="button" onClick={openCreate} style={btnStyle}>+ Create Event</button>
        )}
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <section style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button type="button" onClick={cancel} style={backBtnStyle}>← Back</button>
            <h3 style={{ margin: 0 }}>{editing ? 'Edit event' : 'New event'}</h3>
          </div>
          {status && <p style={{ color: status.ok ? '#166534' : '#991b1b' }}>{status.message}</p>}
          <form onSubmit={submit}>
            <input style={inputStyle} placeholder="Event name *" required maxLength={200} value={form.name} onChange={set('name')} />
            <input style={inputStyle} placeholder="Venue" maxLength={200} value={form.venue} onChange={set('venue')} />
            <input style={inputStyle} placeholder="Date (e.g. Dec 25, 2026)" maxLength={100} value={form.date} onChange={set('date')} />
            <textarea style={{ ...inputStyle, minHeight: 60 }} placeholder="Description" maxLength={500} value={form.description} onChange={set('description')} />

            <section style={paymentSettingsStyle}>
              <label style={paymentToggleStyle}>
                <input
                  type="checkbox"
                  checked={form.payment_required}
                  onChange={(e) => {
                    setStatus(null);
                    setForm((previous) => ({ ...previous, payment_required: e.target.checked }));
                  }}
                />
                <span>Require payment for this event</span>
              </label>
              {form.payment_required && (
                <>
                  <label style={labelStyle} htmlFor="regular-ticket-price">Regular ticket price (PHP)</label>
                  <input
                    id="regular-ticket-price"
                    style={inputStyle}
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={form.regular_ticket_price}
                    onChange={set('regular_ticket_price')}
                  />
                  <label style={labelStyle} htmlFor="vip-ticket-price">VIP ticket price (PHP)</label>
                  <input
                    id="vip-ticket-price"
                    style={inputStyle}
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={form.vip_ticket_price}
                    onChange={set('vip_ticket_price')}
                  />
                  <label style={labelStyle}>Accepted eWallets</label>
                  <div style={walletGridStyle}>
                    {walletOptions.map((wallet) => {
                      const checked = form.payment_methods.includes(wallet.id);
                      return (
                        <label
                          key={wallet.id}
                          style={{
                            ...walletOptionStyle,
                            borderColor: checked ? '#2563eb' : '#cbd5e1',
                            background: checked ? '#eff6ff' : '#fff',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setStatus(null);
                              setForm((previous) => ({
                                ...previous,
                                payment_methods: e.target.checked
                                  ? [...previous.payment_methods, wallet.id]
                                  : previous.payment_methods.filter((method) => method !== wallet.id),
                              }));
                            }}
                          />
                          <img src={wallet.logo} alt="" style={walletLogoStyle} />
                          <span>{wallet.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            <label style={labelStyle}>Poster / Thumbnail</label>
            <input
              style={inputStyle}
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const compressed = await compressImage(file);
                setStatus(null);
                setForm((p) => ({ ...p, image: compressed }));
              }}
            />
            {form.image && (
              <div style={{ marginBottom: 10 }}>
                <img src={form.image} alt="preview" style={imgPreviewStyle} />
                <button type="button" onClick={() => { setStatus(null); setForm((p) => ({ ...p, image: '' })); }} style={removeImgBtnStyle}>Remove image</button>
              </div>
            )}

            {editing && (
              <p style={{ color: '#475569', fontSize: 13, margin: '0 0 14px' }}>
                Increase the seat counts to add more. Existing seats and bookings will not be removed or changed.
              </p>
            )}
            <div style={seatCountInputStyle}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Regular seats</label>
                <input
                  style={inputStyle}
                  type="number"
                  min={editing
                    ? seats.filter((seat) => seat.event_id === editing && seat.seat_type !== 'VIP').length
                    : 0}
                  max={2500}
                  required
                  value={form.regular_seats}
                  onChange={set('regular_seats')}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>VIP seats</label>
                <input
                  style={inputStyle}
                  type="number"
                  min={editing
                    ? seats.filter((seat) => seat.event_id === editing && seat.seat_type === 'VIP').length
                    : 0}
                  max={2500}
                  required
                  value={form.vip_seats}
                  onChange={set('vip_seats')}
                />
              </div>
              <div style={{ paddingTop: 22 }}>
                <div style={seatCountStyle}>
                  {Number(form.regular_seats || 0) + Number(form.vip_seats || 0)} total seats
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" disabled={busy} style={btnStyle}>
                {busy ? 'Saving…' : editing ? status?.ok ? 'Saved' : 'Save changes' : 'Create event'}
              </button>
              <button type="button" onClick={cancel} style={cancelBtnStyle}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      {/* Keep the event list out of the way while creating or editing an event. */}
      {!showForm && (
        <>
          {events.length === 0 && (
            <p style={{ color: '#64748b' }}>No events yet. Click "Create Event" to get started.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {events.map((ev) => {
              const evSeats = seats.filter((s) => s.event_id === ev.event_id);
              const evTickets = tickets.filter((t) => evSeats.some((s) => s.seat_id === t.seat_id));
              const booked = evSeats.filter((s) => s.status === 'BOOKED').length;
              const checkedIn = evTickets.filter((t) => t.is_validated).length;
              const expanded = expandedId === ev.event_id;

              return (
                <div key={ev.event_id} style={cardStyle}>
                  <div style={eventRowStyle}>
                    {ev.image && <img src={ev.image} alt={ev.name} style={eventThumbStyle} />}
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 16 }}>{ev.name}</strong>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        {[ev.venue, ev.date].filter(Boolean).join(' · ')}
                      </div>
                      {ev.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{ev.description}</div>}
                      {ev.payment_required && (
                        <div style={eventPaymentStyle}>
                          Payment required · Regular {formatPrice(ev.regular_ticket_price ?? ev.ticket_price)} · VIP {formatPrice(ev.vip_ticket_price ?? ev.ticket_price)} · {(ev.payment_methods || []).map((method) => walletNames[method] || method).join(', ')}
                        </div>
                      )}
                      <div style={statsRowStyle}>
                        <span style={statBadgeStyle('#dcfce7', '#166534')}>{evSeats.length} seats</span>
                        <span style={statBadgeStyle('#dbeafe', '#1e40af')}>{booked} booked</span>
                        <span style={statBadgeStyle('#fef9c3', '#854d0e')}>{evTickets.length} tickets</span>
                        <span style={statBadgeStyle('#f0fdf4', '#166534')}>{checkedIn} checked in</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <button type="button" onClick={() => setExpandedId(expanded ? null : ev.event_id)} style={outlineBtnStyle}>
                        {expanded ? 'Hide seats' : 'View seats'}
                      </button>
                      <button type="button" onClick={() => openEdit(ev)} style={outlineBtnStyle}>Edit</button>
                      <button type="button" onClick={() => deleteEvent(ev.event_id, ev.name)} style={deleteBtnStyle}>Delete</button>
                    </div>
                  </div>

                  {expanded && (
                    <div style={{ marginTop: 14, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
                      <div style={seatGridStyle}>
                        {evSeats.map((seat) => {
                          const color = seat.status === 'BOOKED' ? '#ef4444'
                            : seat.status === 'HELD' ? '#f59e0b'
                            : seat.seat_type === 'VIP' ? '#8b5cf6' : '#22c55e';
                          return (
                            <div key={seat.seat_id} style={{ ...seatBoxStyle, backgroundColor: color }}>
                              {getSeatLabel(seat)}
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                        Green: available regular · Purple: available VIP · Amber: held · Red: booked
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const cardStyle = { background: '#fff', padding: 20, borderRadius: 10, boxShadow: '0 1px 3px #0000001a' };
const headerRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 };
const inputStyle = { display: 'block', width: '100%', padding: 10, marginBottom: 10, boxSizing: 'border-box', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 };
const btnStyle = { padding: '10px 18px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 600 };
const cancelBtnStyle = { padding: '10px 18px', background: '#e2e8f0', color: '#0f172a', border: 0, borderRadius: 6, cursor: 'pointer' };
const backBtnStyle = { padding: '7px 14px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const outlineBtnStyle = { padding: '5px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
const deleteBtnStyle = { padding: '5px 12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#991b1b' };
const seatCountInputStyle = { display: 'flex', alignItems: 'flex-start', gap: 12, maxWidth: 620 };
const labelStyle = { display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 };
const seatCountStyle = { padding: '10px 0', fontSize: 14, fontWeight: 700, color: '#2563eb' };
const paymentSettingsStyle = { padding: 14, marginBottom: 16, border: '1px solid #bfdbfe', borderRadius: 8, background: '#f8fbff' };
const paymentToggleStyle = { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#1e3a8a', cursor: 'pointer' };
const walletGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 8 };
const walletOptionStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600 };
const walletLogoStyle = { width: 28, height: 24, objectFit: 'contain' };
const eventPaymentStyle = { marginTop: 6, color: '#1e40af', fontSize: 12, fontWeight: 600 };
const eventRowStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' };
const statsRowStyle = { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' };
const statBadgeStyle = (bg, color) => ({ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color });
const seatGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: 5 };
const seatBoxStyle = { padding: '5px 2px', color: '#fff', borderRadius: 5, fontWeight: 700, fontSize: 10, textAlign: 'center' };
const imgPreviewStyle = { display: 'block', width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 6, marginBottom: 6 };
const removeImgBtnStyle = { padding: '7px 12px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fee2e2', color: '#991b1b', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'background 0.15s ease, border-color 0.15s ease' };
const eventThumbStyle = { width: 80, height: 60, objectFit: 'cover', borderRadius: 6, marginRight: 12, flexShrink: 0 };
