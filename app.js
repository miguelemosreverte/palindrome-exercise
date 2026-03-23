const API_BASE =
  document.body?.dataset?.apiBase ||
  ((window.location.hostname.endsWith('github.io') ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost')
    ? 'https://palindrome-exercise.vercel.app'
    : window.location.origin);

function getToken() {
  return localStorage.getItem('auth_token');
}

function setToken(token) {
  if (token) localStorage.setItem('auth_token', token);
}

function clearToken() {
  localStorage.removeItem('auth_token');
}

function getUser() {
  const raw = localStorage.getItem('auth_user');
  return raw ? JSON.parse(raw) : null;
}

function setUser(user) {
  if (user) localStorage.setItem('auth_user', JSON.stringify(user));
}

function logout() {
  clearToken();
  localStorage.removeItem('auth_user');
  window.location.href = '/';
}

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function setStatus(node, kind, message) {
  if (!node) return;
  node.className = `status show ${kind}`;
  node.textContent = message;
}

function formatDate(ts) {
  if (!ts) return 'Sin actividad';
  return new Date(ts).toLocaleString('es-AR');
}

function formatUsd(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}

function bindAuthLinks() {
  const authLinks = document.querySelectorAll('[data-auth-link]');
  const user = getUser();
  for (const link of authLinks) {
    if (user) {
      link.textContent = user.email;
      link.href = '/dashboard.html';
    }
  }

  const logoutButtons = document.querySelectorAll('[data-logout]');
  for (const btn of logoutButtons) {
    btn.addEventListener('click', logout);
  }
}

window.AppBridge = {
  API_BASE,
  apiFetch,
  bindAuthLinks,
  clearToken,
  formatDate,
  formatUsd,
  getToken,
  getUser,
  logout,
  setStatus,
  setToken,
  setUser,
};
