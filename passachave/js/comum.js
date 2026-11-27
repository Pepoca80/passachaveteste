// Funções usadas em todas as páginas

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (seletor) => document.querySelector(seletor);

// Evita que textos digitados pelo usuário virem HTML
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const dinheiro = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => new Date(iso + 'T00:00').toLocaleDateString('pt-BR');
const dataHora = (iso) => iso ? new Date(iso).toLocaleString('pt-BR') : '—';
const somenteDigitos = (t) => String(t ?? '').replace(/\D/g, '');

// Data de hoje no formato AAAA-MM-DD (para o min dos inputs de data)
function hoje() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// Confere os dígitos verificadores do CPF
function validarCPF(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    if ((soma * 10) % 11 % 10 !== Number(cpf[n])) return false;
  }
  return true;
}

const STATUS = { pendente: 'Aguardando resposta', aceita: 'Confirmada', recusada: 'Recusada', cancelada: 'Cancelada' };

let toastTimer;
function toast(mensagem) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = mensagem;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 4000);
}

// Traduz as mensagens de erro mais comuns do Supabase Auth
function traduzErro(erro) {
  const msg = erro?.message || String(erro);
  if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('already registered')) return 'Este e-mail já está cadastrado.';
  if (msg.includes('Email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (msg.includes('at least 6')) return 'A senha precisa ter pelo menos 6 caracteres.';
  return msg;
}

async function buscarPerfil(userId) {
  const { data } = await sb.from('perfis').select('*').eq('id', userId).single();
  return data;
}

// Usado na tela interna: garante que há alguém logado
async function exigirLogin() {
  const { data } = await sb.auth.getSession();
  const usuario = data.session?.user;
  if (!usuario) { location.href = 'login.html'; return null; }

  const perfil = await buscarPerfil(usuario.id);
  if (!perfil) { await sb.auth.signOut(); location.href = 'login.html'; return null; }

  $('#usuario-nome').textContent = perfil.nome;
  $('#btn-sair').onclick = async () => { await sb.auth.signOut(); location.href = 'index.html'; };
  return { usuario, perfil };
}

// ---------- Imagens ----------
// Ilustração do carro (usada quando o anúncio não tem foto)
function desenhoCarro(id, grande = false) {
  const cor = [...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) * 47 % 360;
  return `<div class="art${grande ? ' big' : ''}" style="--h:${cor}">
    <svg viewBox="0 0 120 50" aria-hidden="true">
      <path d="M8 34l8-14c2-4 6-6 10-6h40c5 0 9 2 12 6l8 8c6 1 12 3 12 8v4H8z" fill="currentColor"/>
      <circle cx="32" cy="40" r="7" fill="var(--surf)"/><circle cx="92" cy="40" r="7" fill="var(--surf)"/>
    </svg></div>`;
}

// Primeira foto do anúncio ou, se não houver, a ilustração
function capaVeiculo(v, grande = false) {
  const f = (v.fotos || [])[0];
  return f ? `<img class="foto${grande ? ' big' : ''}" src="${esc(f)}" alt="${esc(v.modelo)}" loading="lazy">` : desenhoCarro(v.id, grande);
}

// Reduz a foto (máx. 1280 px) e converte para JPEG antes de enviar
function reduzirImagem(arquivo, max = 1280) {
  return new Promise((ok, falha) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => b ? ok(b) : falha(new Error('Não foi possível processar a imagem.')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Arquivo de imagem inválido.')); };
    img.src = url;
  });
}

// Caminho do arquivo no Storage a partir da URL pública
const caminhoDaFoto = (url) => decodeURIComponent((String(url).split('/object/public/veiculos/')[1] || '').split('?')[0]);
