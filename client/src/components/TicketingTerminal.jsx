import React from 'react';
import { useState } from 'react';
import { invokeRpc } from '../config/api';

export default function TicketingTerminal({ seats, tickets, nodeId, onRefresh }) {
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [attendeeName, setAttendeeName] = useState('');
  const [status, setStatus] = useState(null);
  const [issuedTicket, setIssuedTicket] = useState(null);
  const [busy, setBusy] = useState(false);

  const selectSeat = async (seat) => {
    setStatus(null);
    setBusy(true);
    try {
      const result = await invokeRpc('LockSeatProcedure', {
        seat_id: seat.seat_id,
        node_id: nodeId,
        timeout: 180,
      });
      if (result.success) {
        setSelectedSeat(seat);
        setStatus({ success: true, message: result.message });
      } else {
        setStatus({ success: false, message: result.message });
      }
      await onRefresh();
    } catch (error) {
      setStatus({ success: false, message: `Seat lock failed: ${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  const bookSeat = async (event) => {
    event.preventDefault();
    if (!selectedSeat || !attendeeName.trim()) return;

    setBusy(true);
    try {
      const result = await invokeRpc('BookSeatProcedure', {
        seat_id: selectedSeat.seat_id,
        node_id: nodeId,
        attendee_name: attendeeName.trim(),
      });
      if (result.success) {
        setIssuedTicket(result.ticket);
        setSelectedSeat(null);
        setAttendeeName('');
      }
      setStatus({ success: result.success, message: result.message });
      await onRefresh();
    } catch (error) {
      setStatus({ success: false, message: `Booking failed: ${error.message}` });
    } finally {
      setBusy(false);
    }
  };

  const copyPayload = async (payload) => {
    try {
      await navigator.clipboard.writeText(payload);
      setStatus({ success: true, message: 'Ticket payload copied.' });
    } catch (error) {
      setStatus({ success: false, message: `Unable to copy ticket: ${error.message}` });
    }
  };

  return (
    <div style={layoutStyle}>
      <section style={cardStyle}>
        <h2>Seat selection</h2>
        <p>Terminal: <strong>{nodeId}</strong></p>
        <div style={seatGridStyle}>
          {seats.map((seat) => {
            const isMine = seat.status === 'HELD' && seat.locked_by === nodeId;
            const color = seat.status === 'BOOKED'
              ? '#ef4444'
              : isMine
                ? '#3b82f6'
                : seat.status === 'HELD'
                  ? '#f59e0b'
                  : '#22c55e';

            return (
              <button
                key={seat.seat_id}
                type="button"
                onClick={() => selectSeat(seat)}
                disabled={busy || (seat.status === 'BOOKED' && !isMine)}
                title={`Status: ${seat.status}${seat.locked_by ? ` by ${seat.locked_by}` : ''}`}
                style={{ ...seatButtonStyle, backgroundColor: color }}
              >
                {seat.row_number}{seat.seat_number}
              </button>
            );
          })}
          {seats.length === 0 && <p>No seats are configured yet.</p>}
        </div>
        <p>Green: available · Blue: held by this terminal · Amber: held · Red: booked</p>
      </section>

      <section style={cardStyle}>
        <h2>Reservation and tickets</h2>
        {status && (
          <p role="status" style={{ color: status.success ? '#166534' : '#991b1b' }}>
            {status.message}
          </p>
        )}
        {selectedSeat ? (
          <form onSubmit={bookSeat}>
            <p>
              Selected seat: <strong>{selectedSeat.row_number}{selectedSeat.seat_number}</strong>
            </p>
            <input
              aria-label="Attendee full name"
              type="text"
              autoComplete="name"
              maxLength={200}
              placeholder="Attendee full name"
              value={attendeeName}
              onChange={(event) => setAttendeeName(event.target.value)}
              required
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              {busy ? 'Processing…' : 'Book seat'}
            </button>
          </form>
        ) : <p>Select an available seat to reserve it.</p>}

        {issuedTicket && (
          <div style={ticketStyle}>
            <h3>Ticket issued</h3>
            <p>{issuedTicket.attendee_name} · Seat {issuedTicket.seat_label}</p>
            <textarea readOnly value={issuedTicket.qr_hash} style={payloadStyle} />
            <button type="button" onClick={() => copyPayload(issuedTicket.qr_hash)} style={buttonStyle}>
              Copy ticket payload
            </button>
          </div>
        )}

        <h3>Issued tickets</h3>
        <ul style={ticketListStyle}>
          {tickets.map((ticket) => (
            <li key={ticket.ticket_id}>
              <button
                type="button"
                onClick={() => copyPayload(ticket.qr_hash)}
                style={ticketRowStyle}
                title="Copy ticket payload"
              >
                <span>
                  {ticket.row_number}{ticket.seat_number} · {ticket.attendee_name}
                </span>
                <span>{ticket.is_validated ? `Checked in (${ticket.validated_by_terminal})` : 'Unscanned · Copy'}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const cardStyle = { background: '#fff', padding: 20, borderRadius: 10, boxShadow: '0 1px 3px #0000001a' };
const layoutStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 };
const seatGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(10, minmax(36px, 1fr))', gap: 8 };
const seatButtonStyle = { padding: '10px 4px', color: '#fff', border: 0, borderRadius: 6, fontWeight: 700, cursor: 'pointer' };
const inputStyle = { width: '100%', padding: 10, marginBottom: 10, boxSizing: 'border-box' };
const buttonStyle = { padding: '10px 14px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' };
const ticketStyle = { marginTop: 16, padding: 14, background: '#f8fafc', borderRadius: 8 };
const payloadStyle = { display: 'block', width: '100%', minHeight: 65, boxSizing: 'border-box', marginBottom: 8, fontFamily: 'monospace' };
const ticketListStyle = { listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflow: 'auto' };
const ticketRowStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', padding: 10, textAlign: 'left', background: '#fff', border: 0, borderBottom: '1px solid #e2e8f0', cursor: 'pointer' };
