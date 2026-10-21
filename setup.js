// Password setup page: makes ADMIN_PASSWORD_HASH in the browser.
import { hashPassword } from './shared/crypto.js';

const form = document.getElementById('setup-form');
const msg = document.getElementById('su-msg');
const out = document.getElementById('su-out');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = document.getElementById('su-pass').value;
  const b = document.getElementById('su-pass2').value;
  out.hidden = true;
  msg.classList.remove('is-ok');
  if (a.length < 8) {
    msg.textContent = 'Use at least 8 characters.';
    return;
  }
  if (a !== b) {
    msg.textContent = 'The two passwords don’t match.';
    return;
  }
  const btn = form.querySelector('.btn');
  btn.classList.add('is-loading');
  btn.disabled = true;
  try {
    document.getElementById('su-hash').value = await hashPassword(a);
    msg.classList.add('is-ok');
    msg.textContent = a.length < 10 || !/[A-Za-z]/.test(a) || !/\d/.test(a) ? 'Done. Tip: a longer password with letters and numbers is safer.' : 'Done. Copy the value into Netlify.';
    out.hidden = false;
    document.getElementById('su-pass').value = '';
    document.getElementById('su-pass2').value = '';
  } catch {
    msg.textContent = 'This browser can’t create the hash. Try a current version of Chrome, Edge, Firefox or Safari.';
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
});

for (const b of document.querySelectorAll('[data-copy]')) {
  b.addEventListener('click', async () => {
    const field = document.getElementById(b.getAttribute('data-copy'));
    try {
      await navigator.clipboard.writeText(field.value);
      b.textContent = 'Copied';
    } catch {
      field.select();
      b.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => (b.textContent = 'Copy'), 2000);
  });
}
