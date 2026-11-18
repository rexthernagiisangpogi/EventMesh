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
    eventSeats
      .sort(compareSeatOrder)
      .forEach((seat, index) => {
        labeledSeats.push({ ...seat, seat_label: `S${index + 1}` });
      });
  }

  return labeledSeats;
}

module.exports = { assignSeatLabels };
