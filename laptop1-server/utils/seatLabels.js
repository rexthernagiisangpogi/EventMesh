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
  return [...seats]
    .sort(compareSeatOrder)
    .map((seat, index) => ({ ...seat, seat_label: `S${index + 1}` }));
}

module.exports = { assignSeatLabels };
