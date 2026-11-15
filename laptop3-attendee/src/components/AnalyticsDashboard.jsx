import React from 'react';

export default function AnalyticsDashboard({ metrics = {}, recentLogs = [], alerts = [] }) {
  const cards = [
    ['Venue capacity', metrics.totalCapacity],
    ['Seats booked', metrics.seatsBooked],
    ['Checked in', metrics.totalCheckedIn],
    ['Remaining capacity', metrics.remainingCapacity],
  ];

  return (
    <section style={cardStyle}>
      <h2>Live venue occupancy and gate telemetry</h2>
      {alerts.length > 0 && (
        <div aria-live="polite">
          {alerts.map((alert, index) => (
            <div key={`${alert.ticket_id || alert.code}-${index}`} style={alertStyle}>
              <strong>{alert.code}:</strong> {alert.message}
            </div>
          ))}
        </div>
      )}

      <div style={metricsGridStyle}>
        {cards.map(([label, value]) => (
          <div key={label} style={metricCardStyle}>
            <div>{label}</div>
            <strong style={metricValueStyle}>{value ?? 0}</strong>
          </div>
        ))}
      </div>

      <h3>Recent gate entries</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Log</th>
              <th style={cellStyle}>Attendee</th>
              <th style={cellStyle}>Terminal</th>
              <th style={cellStyle}>Scanned</th>
              <th style={cellStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {recentLogs.map((log) => (
              <tr key={log.log_id}>
                <td style={cellStyle}>#{log.log_id}</td>
                <td style={cellStyle}>{log.attendee_name || log.ticket_id}</td>
                <td style={cellStyle}>{log.terminal_id}</td>
                <td style={cellStyle}>
                  {new Date(log.scan_timestamp).toLocaleString()}
                </td>
                <td style={{
                  ...cellStyle,
                  color: log.sync_status === 'CONFLICT' ? '#dc2626' : '#166534',
                  fontWeight: 700,
                }}>
                  {log.sync_status}
                </td>
              </tr>
            ))}
            {recentLogs.length === 0 && (
              <tr><td style={cellStyle} colSpan="5">No gate entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const cardStyle = { background: '#fff', padding: 20, borderRadius: 10, boxShadow: '0 1px 3px #0000001a' };
const alertStyle = { padding: 12, marginBottom: 8, background: '#fef2f2', borderLeft: '5px solid #dc2626', color: '#991b1b' };
const metricsGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, margin: '20px 0' };
const metricCardStyle = { padding: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, textAlign: 'center' };
const metricValueStyle = { display: 'block', marginTop: 4, fontSize: 26 };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' };
const cellStyle = { padding: '8px 10px', borderBottom: '1px solid #e2e8f0' };
