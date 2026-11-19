function compareSeatOrder(left, right) {
  const leftLegacy = /_R\d+S\d+$/.test(left.seat_id);
  const rightLegacy = /_R\d+S\d+$/.test(right.seat_id);
  if (leftLegacy !== rightLegacy) return leftLegacy ? -1 : 1;

  if (leftLegacy) {
    return left.row_number - right.row_number || left.seat_number - right.seat_number;
  }
  return left.seat_number - right.seat_number;
}

function assignSeatLabels(seats) {
  const seatsByEvent = new Map();

  for (const seat of seats) {
    const eventId = seat.event_id || '';
    if (!seatsByEvent.has(eventId)) seatsByEvent.set(eventId, []);
    seatsByEvent.get(eventId).push(seat);
  }

  const labeledSeats = [];
  for (const eventSeats of seatsByEvent.values()) {
    const seatNumbers = { REGULAR: 0, VIP: 0 };
    eventSeats
      .sort((left, right) => {
        const leftType = left.seat_type === 'VIP' ? 'VIP' : 'REGULAR';
        const rightType = right.seat_type === 'VIP' ? 'VIP' : 'REGULAR';
        return leftType.localeCompare(rightType) || compareSeatOrder(left, right);
      })
      .forEach((seat) => {
        const seatType = seat.seat_type === 'VIP' ? 'VIP' : 'REGULAR';
        seatNumbers[seatType]++;
        const prefix = seatType === 'VIP' ? 'V' : 'R';
        labeledSeats.push({ ...seat, seat_label: `${prefix}${seatNumbers[seatType]}` });
      });
  }

  return labeledSeats;
}

module.exports = { assignSeatLabels };
