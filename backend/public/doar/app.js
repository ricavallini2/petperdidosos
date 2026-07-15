// PetPerdidoSOS — página de doação (/doar)
// Arquivo externo (não inline) por causa do CSP script-src 'self' do backend.

document.getElementById('year').textContent = new Date().getFullYear();

const fmt = (n) => n.toLocaleString('pt-BR');
const money = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ── Estatísticas ──
fetch('/public/stats')
  .then((r) => r.json())
  .then((s) => {
    document.getElementById('st-happy').textContent = fmt(s.happyEndings ?? 0);
    document.getElementById('st-active').textContent = fmt(s.activeAlerts ?? 0);
    document.getElementById('st-users').textContent = fmt(s.users ?? 0);
    document.getElementById('stats').hidden = false;
  })
  .catch(() => {});

// ── Casos de sucesso ──
const typeLabel = { lost: 'REENCONTRADO', sighted: 'REENCONTRADO', rescued: 'REENCONTRADO', donation: 'ADOTADO' };
fetch('/public/success-cases?limit=12')
  .then((r) => r.json())
  .then((list) => {
    const grid = document.getElementById('cases');
    if (!Array.isArray(list) || list.length === 0) {
      document.getElementById('casesEmpty').hidden = false;
      return;
    }
    list.forEach((c) => {
      const el = document.createElement('article');
      el.className = 'case';
      const days =
        c.days_lost != null && c.days_lost > 0
          ? `De volta pra casa após ${c.days_lost} dia${c.days_lost > 1 ? 's' : ''}`
          : 'De volta pra casa 🏠';
      const img = c.photo_url
        ? `<img src="${encodeURI(c.photo_url)}" alt="Foto de ${escapeHtml(c.pet_name)}" loading="lazy" />`
        : '';
      el.innerHTML =
        `<div class="ph">${img}<span class="tag">✓ ${typeLabel[c.pet_type] ?? 'FINAL FELIZ'}</span></div>` +
        `<div class="body"><h3>${escapeHtml(c.pet_name)}</h3>` +
        `<div class="days">${escapeHtml(days)}</div>` +
        (c.message ? `<p class="msg">“${escapeHtml(c.message)}”</p>` : '') +
        (c.tutor_first_name ? `<div class="by">— ${escapeHtml(c.tutor_first_name)}, tutor(a)</div>` : '') +
        `</div>`;
      grid.appendChild(el);
    });
  })
  .catch(() => {
    document.getElementById('casesEmpty').hidden = false;
  });

// ── Doação Pix ──
let selected = 25;
const chips = document.querySelectorAll('.amount');
const customInput = document.getElementById('customAmount');
const customField = document.getElementById('customField');

chips.forEach((ch) =>
  ch.addEventListener('click', () => {
    chips.forEach((c) => c.classList.remove('active'));
    ch.classList.add('active');
    customField.classList.remove('active');
    customInput.value = '';
    selected = Number(ch.dataset.v);
    generatePix(); // gera direto ao tocar no valor
  })
);

customInput.addEventListener('input', () => {
  chips.forEach((c) => c.classList.remove('active'));
  customField.classList.add('active');
  selected = Number(customInput.value.replace(',', '.'));
});

document.getElementById('generateBtn').addEventListener('click', generatePix);
customInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generatePix();
});

async function generatePix() {
  const err = document.getElementById('pixError');
  const box = document.getElementById('pixResult');
  err.style.display = 'none';
  if (!selected || selected < 1) {
    err.textContent = 'Escolha um valor de pelo menos R$ 1,00.';
    err.style.display = 'block';
    box.classList.remove('show');
    return;
  }
  try {
    const r = await fetch('/public/donation/pix?amount=' + encodeURIComponent(selected));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Não foi possível gerar o Pix agora.');
    document.getElementById('qrBox').innerHTML = data.qrSvg;
    document.getElementById('pixAmount').textContent = money(data.amount);
    document.getElementById('pixPayload').textContent = data.payload;
    box.classList.add('show');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
    box.classList.remove('show');
  }
}

document.getElementById('copyBtn').addEventListener('click', async () => {
  const text = document.getElementById('pixPayload').textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const btn = document.getElementById('copyBtn');
  const old = btn.textContent;
  btn.textContent = '✅ Copiado! Cole no app do banco';
  setTimeout(() => (btn.textContent = old), 2600);
});
