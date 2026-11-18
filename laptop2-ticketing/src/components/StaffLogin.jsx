import React, { useState } from 'react';
import { loginStaff } from '../config/api';

export default function StaffLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await loginStaff(password);
      onLogin();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={loginPageStyle}>
      <form onSubmit={submit} style={loginCardStyle}>
        <p style={loginEyebrowStyle}>EVENTMESH STAFF</p>
        <h1 style={loginHeadingStyle}>Staff sign in</h1>
        <p style={loginCopyStyle}>Enter the shared staff password to manage events and tickets.</p>
        <label htmlFor="staff-password" style={loginLabelStyle}>Staff password</label>
        <input
          id="staff-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={loginInputStyle}
        />
        {error && <p role="alert" style={loginErrorStyle}>{error}</p>}
        <button type="submit" disabled={busy} style={loginButtonStyle}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

const loginPageStyle = { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' };
const loginCardStyle = { width: '100%', maxWidth: 420, padding: 32, boxSizing: 'border-box', borderRadius: 16, background: '#fff', boxShadow: '0 12px 40px #0f172a18' };
const loginEyebrowStyle = { margin: 0, color: '#2563eb', fontSize: 11, fontWeight: 800, letterSpacing: 1.5 };
const loginHeadingStyle = { margin: '8px 0', color: '#0f172a', fontSize: 28 };
const loginCopyStyle = { margin: '0 0 24px', color: '#64748b', fontSize: 14, lineHeight: 1.5 };
const loginLabelStyle = { display: 'block', marginBottom: 6, color: '#334155', fontSize: 13, fontWeight: 700 };
const loginInputStyle = { width: '100%', padding: 12, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 15 };
const loginErrorStyle = { color: '#b91c1c', fontSize: 13 };
const loginButtonStyle = { width: '100%', marginTop: 16, padding: 12, border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' };
