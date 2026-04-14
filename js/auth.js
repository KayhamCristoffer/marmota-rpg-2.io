// ============================================================
// AUTH.JS - Login/Registro com Supabase
// ============================================================
import { signIn, signUp, resetPassword, onAuthStateChange } from '../supabase/database.js';
import { showToast } from '../supabase/session-manager.js';

// ── Redireciona se já logado ─────────────────────────────────
onAuthStateChange((user) => {
  if (user) window.location.href = 'home.html';
});

// ── Loader ───────────────────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(() => document.getElementById('pageLoader')?.classList.add('hide'), 800);
});

// ── Partículas ───────────────────────────────────────────────
(function spawnParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 15; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 2;
    p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;opacity:${Math.random()*.6+.2};animation-duration:${Math.random()*10+8}s;animation-delay:${Math.random()*8}s`;
    container.appendChild(p);
  }
})();

// ── Overlay helpers ──────────────────────────────────────────
function openOverlay(id)  { document.getElementById(id)?.classList.add('open'); }
function closeOverlay(id) { document.getElementById(id)?.classList.remove('open'); }
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  const span = el.querySelector('span');
  if (span) span.textContent = msg;
  el.closest('.auth-box')?.classList.add('shake');
  setTimeout(() => el.closest('.auth-box')?.classList.remove('shake'), 500);
}
function hideError(id) { document.getElementById(id)?.classList.remove('show'); }
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<i class="fas fa-circle-notch spin-icon"></i> Aguarde…`
    : btn.dataset.originalText;
}

// Salva texto original dos botões
['submitLoginBtn', 'submitRegisterBtn', 'sendResetBtn'].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) btn.dataset.originalText = btn.innerHTML;
});

// ── Botões de abrir overlays ─────────────────────────────────
document.getElementById('openLoginBtn')?.addEventListener('click',    () => openOverlay('loginOverlay'));
document.getElementById('openRegisterBtn')?.addEventListener('click', () => openOverlay('registerOverlay'));
document.getElementById('closeLogin')?.addEventListener('click',    () => closeOverlay('loginOverlay'));
document.getElementById('closeRegister')?.addEventListener('click', () => closeOverlay('registerOverlay'));
document.getElementById('closeForgot')?.addEventListener('click',   () => closeOverlay('forgotOverlay'));
document.getElementById('goToRegister')?.addEventListener('click',  () => { closeOverlay('loginOverlay'); openOverlay('registerOverlay'); });
document.getElementById('goToLogin')?.addEventListener('click',     () => { closeOverlay('registerOverlay'); openOverlay('loginOverlay'); });
document.getElementById('forgotPasswordLink')?.addEventListener('click', () => { closeOverlay('loginOverlay'); openOverlay('forgotOverlay'); });
document.getElementById('backToLoginBtn')?.addEventListener('click', () => { closeOverlay('forgotOverlay'); openOverlay('loginOverlay'); });
document.getElementById('forgotDoneBtn')?.addEventListener('click',  () => { closeOverlay('forgotOverlay'); openOverlay('loginOverlay'); });

// Fecha ao clicar fora
['loginOverlay','registerOverlay','forgotOverlay'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', (e) => {
    if (e.target.id === id) closeOverlay(id);
  });
});

// ── Toggle password visibility ───────────────────────────────
function togglePwd(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (!input || !icon) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
}
document.getElementById('toggleLoginPwd')?.addEventListener('click',    () => togglePwd('loginPassword', 'eyeLoginIcon'));
document.getElementById('toggleRegPwd')?.addEventListener('click',      () => togglePwd('regPassword', 'eyeRegIcon'));
document.getElementById('toggleRegConfirm')?.addEventListener('click',  () => togglePwd('regConfirm', 'eyeRegConfirmIcon'));

// ── Password strength ─────────────────────────────────────────
document.getElementById('regPassword')?.addEventListener('input', (e) => {
  const val  = e.target.value;
  const wrap = document.getElementById('pwdStrengthWrap');
  const lbl  = document.getElementById('pwdStrengthLabel');
  if (!wrap || !lbl) return;
  if (!val) { wrap.className = 'pwd-strength-wrap'; return; }
  wrap.classList.add('visible');
  let score = 0;
  if (val.length >= 6)  score++;
  if (val.length >= 10) score++;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  score = Math.min(4, score);
  wrap.className = `pwd-strength-wrap visible str-${score}`;
  lbl.textContent = ['Digite uma senha','Fraca','Regular','Boa','Forte'][score];
});

// Confirmar senha
document.getElementById('regConfirm')?.addEventListener('input', () => {
  const pwd  = document.getElementById('regPassword')?.value;
  const conf = document.getElementById('regConfirm')?.value;
  const hint = document.getElementById('regConfirmHint');
  if (!hint) return;
  if (!conf) { hint.textContent = ''; hint.className = 'field-hint'; return; }
  if (pwd === conf) { hint.textContent = '✓ Senhas conferem'; hint.className = 'field-hint ok'; }
  else              { hint.textContent = '✗ Senhas não conferem'; hint.className = 'field-hint err'; }
});

// ── LOGIN ─────────────────────────────────────────────────────
document.getElementById('submitLoginBtn')?.addEventListener('click', async () => {
  hideError('loginError');
  const email    = document.getElementById('loginEmail')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  if (!email || !password) { showError('loginError', 'Preencha e-mail e senha.'); return; }
  setLoading('submitLoginBtn', true);
  try {
    await signIn(email, password);
    showToast('Login realizado! Redirecionando…', 'success');
    setTimeout(() => window.location.href = 'home.html', 800);
  } catch (err) {
    setLoading('submitLoginBtn', false);
    const msgs = {
      'Invalid login credentials': 'E-mail ou senha incorretos.',
      'Email not confirmed':       'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
      'Too many requests':         'Muitas tentativas. Aguarde alguns minutos.'
    };
    showError('loginError', msgs[err.message] || err.message);
  }
});

// Enter no campo de senha faz login
document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('submitLoginBtn')?.click();
});

// ── CADASTRO ──────────────────────────────────────────────────
document.getElementById('submitRegisterBtn')?.addEventListener('click', async () => {
  hideError('registerError');
  const nickname = document.getElementById('regName')?.value?.trim();
  const email    = document.getElementById('regEmail')?.value?.trim();
  const password = document.getElementById('regPassword')?.value;
  const confirm  = document.getElementById('regConfirm')?.value;

  if (!nickname || nickname.length < 2) { showError('registerError', 'Nickname deve ter pelo menos 2 caracteres.'); return; }
  if (!email) { showError('registerError', 'Informe um e-mail válido.'); return; }
  if (!password || password.length < 6) { showError('registerError', 'Senha deve ter pelo menos 6 caracteres.'); return; }
  if (password !== confirm) { showError('registerError', 'As senhas não conferem.'); return; }

  setLoading('submitRegisterBtn', true);
  try {
    await signUp(email, password, nickname);
    closeOverlay('registerOverlay');
    openOverlay('loginOverlay');
    showToast('Conta criada! Verifique seu e-mail para confirmar.', 'success', 6000);
  } catch (err) {
    setLoading('submitRegisterBtn', false);
    const msgs = {
      'User already registered':         'Este e-mail já está cadastrado.',
      'duplicate key value violates':    'Este nickname já está em uso.',
      'Password should be at least 6':   'Senha muito curta (mínimo 6 caracteres).'
    };
    const msg = Object.entries(msgs).find(([k]) => err.message?.includes(k));
    showError('registerError', msg ? msg[1] : err.message);
  }
});

// ── REDEFINIÇÃO DE SENHA ──────────────────────────────────────
document.getElementById('sendResetBtn')?.addEventListener('click', async () => {
  hideError('forgotError');
  const email = document.getElementById('forgotEmail')?.value?.trim();
  if (!email) { showError('forgotError', 'Informe um e-mail.'); return; }
  setLoading('sendResetBtn', true);
  try {
    await resetPassword(email);
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
    document.getElementById('fstep1')?.classList.remove('active');
    document.getElementById('fstep2')?.classList.add('active');
  } catch (err) {
    setLoading('sendResetBtn', false);
    showError('forgotError', err.message || 'Erro ao enviar e-mail. Tente novamente.');
  }
});
