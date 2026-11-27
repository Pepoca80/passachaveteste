// Tela principal: a mesma conta aluga e anuncia carros

let usuario = null, perfil = null, doc = null;
let veiculos = [], reservas = [], meusCarros = [], recebidas = [];
let modo = 'alugar', aba = 'buscar', sel = null, fotoIdx = 0;
const filtro = { q: '', tipo: '', max: '' };
let pedido = { inicio: '', fim: '', protecao: 'basica', aceito: false };

const TAXA = 0.12;          // taxa da plataforma (o banco recalcula o valor final)
const PROTECAO_DIA = 18;
const MAX_FOTOS = 6;
const ABAS = {
  alugar:   [['buscar', 'Buscar carros'], ['reservas', 'Minhas reservas']],
  anunciar: [['recebidas', 'Solicitações'], ['carros', 'Meus carros']]
};

async function iniciar() {
  const sessao = await exigirLogin();
  if (!sessao) return;
  usuario = sessao.usuario;
  perfil = sessao.perfil;
  await carregar();
  render();
}

async function carregar() {
  const [v, r, mc, rc, d] = await Promise.all([
    sb.from('veiculos').select('*, dono:perfis!dono_id(nome)')
      .eq('ativo', true).neq('dono_id', usuario.id).order('created_at', { ascending: false }),
    sb.from('reservas').select('*, veiculo:veiculos(id, modelo, cidade, dono:perfis!dono_id(nome))')
      .eq('locatario_id', usuario.id).order('created_at', { ascending: false }),
    sb.from('veiculos').select('*').eq('dono_id', usuario.id).order('created_at', { ascending: false }),
    sb.from('reservas').select('*, veiculo:veiculos!inner(modelo, dono_id), locatario:perfis!locatario_id(nome)')
      .eq('veiculo.dono_id', usuario.id).order('created_at', { ascending: false }),
    sb.from('documentos').select('*').eq('id', usuario.id).maybeSingle()
  ]);
  const erro = v.error || r.error || mc.error || rc.error || d.error;
  if (erro) toast('Erro ao carregar: ' + erro.message);
  veiculos = v.data || []; reservas = r.data || [];
  meusCarros = mc.data || []; recebidas = rc.data || [];
  doc = d.data || null;
}

// ---------------- Cálculo do valor (só para exibir; o banco recalcula) ----------------
function calcular() {
  const { inicio, fim, protecao } = pedido;
  if (!inicio || !fim || fim <= inicio) return null;
  const dias = Math.round((new Date(fim) - new Date(inicio)) / 864e5);
  const subtotal = dias * Number(sel.preco_dia);
  const taxa = Math.round(subtotal * TAXA * 100) / 100;
  const extra = protecao === 'completa' ? dias * PROTECAO_DIA : 0;
  return { dias, subtotal, taxa, extra, total: subtotal + taxa + extra };
}

const botaoPerfil = `<button class="btn s" data-acao="aba" data-aba="perfil">Completar perfil</button>`;

// ---------------- Telas: alugar ----------------
function telaBusca() {
  const tipos = ['Compacto', 'Sedã', 'SUV', 'Minivan'];
  return `
    <div class="filtros">
      <input data-filtro="q" placeholder="Cidade ou modelo" value="${esc(filtro.q)}" aria-label="Cidade ou modelo">
      <select data-filtro="tipo" aria-label="Tipo">
        <option value="">Todos os tipos</option>
        ${tipos.map(t => `<option ${filtro.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input data-filtro="max" type="number" min="0" placeholder="Preço máx. / dia" value="${esc(filtro.max)}" style="max-width:170px" aria-label="Preço máximo por dia">
    </div>
    <div id="resultados">${listaCarros()}</div>`;
}

function listaCarros() {
  const q = filtro.q.toLowerCase();
  const lista = veiculos.filter(v =>
    (!q || (v.modelo + ' ' + v.cidade).toLowerCase().includes(q)) &&
    (!filtro.tipo || v.tipo === filtro.tipo) &&
    (!filtro.max || Number(v.preco_dia) <= Number(filtro.max)));
  if (!lista.length) return `<div class="vazio">Nenhum carro encontrado. Tente outra cidade ou aumente o preço máximo.</div>`;
  return `<div class="grid">${lista.map(v => `
    <article class="card">
      ${capaVeiculo(v)}
      <div class="b">
        <h3>${esc(v.modelo)}</h3>
        <div class="mu">${esc(v.cidade)} · ${v.cambio} · ${v.lugares} lugares</div>
        <div class="row" style="margin-top:auto">
          <span><b>${dinheiro(v.preco_dia)}</b> <span class="mu">/ dia</span></span>
          <button class="btn s p" data-acao="abrir" data-id="${v.id}">Ver detalhes</button>
        </div>
      </div>
    </article>`).join('')}</div>`;
}

function telaDetalhe() {
  const v = sel, fs = v.fotos || [];
  const aviso = doc?.cnh ? '' : `<div class="aviso-box">Para reservar, complete seu perfil com CPF, telefone e CNH. Esses dados entram no contrato. ${botaoPerfil}</div>`;
  return `
    <button class="btn s" data-acao="voltar">‹ Voltar</button>
    <div class="det">
      <div class="list">
        ${fs.length ? `<img class="foto big" src="${esc(fs[fotoIdx] || fs[0])}" alt="Foto ${fotoIdx + 1} de ${esc(v.modelo)}">` : desenhoCarro(v.id, true)}
        ${fs.length > 1 ? `<div class="thumbs">${fs.map((f, i) => `<button data-acao="foto" data-i="${i}" aria-label="Ver foto ${i + 1}" aria-current="${i === fotoIdx}"><img src="${esc(f)}" alt=""></button>`).join('')}</div>` : ''}
        <h1>${esc(v.modelo)}</h1>
        <div class="mu">${esc(v.cidade)} · ${v.tipo} · ${v.cambio} · ${v.lugares} lugares</div>
        <div class="box">
          <b>Proprietário: ${esc(v.dono?.nome)}</b>
          <span class="mu">Retirada em local combinado com o proprietário.</span>
        </div>
      </div>
      <div class="box">
        ${aviso}
        <div><b style="font-size:24px">${dinheiro(v.preco_dia)}</b> <span class="mu">/ dia</span></div>
        <label class="fld">Retirada <input type="date" data-pedido="inicio" min="${hoje()}" value="${pedido.inicio}"></label>
        <label class="fld">Devolução <input type="date" data-pedido="fim" min="${hoje()}" value="${pedido.fim}"></label>
        <label class="fld">Proteção
          <select data-pedido="protecao">
            <option value="basica">Básica (incluída)</option>
            <option value="completa" ${pedido.protecao === 'completa' ? 'selected' : ''}>Completa (+ ${dinheiro(PROTECAO_DIA)} / dia)</option>
          </select>
        </label>
        <div class="check">
          <input type="checkbox" id="aceite" data-pedido="aceito" ${pedido.aceito ? 'checked' : ''}>
          <label for="aceite">Li e aceito o contrato de locação, inclusive minha responsabilidade por multas, danos, furto e roubo durante o período.</label>
        </div>
        <button class="btn s" data-acao="previa">Ler o contrato</button>
        <div class="list" id="resumo" style="gap:8px">${resumo()}</div>
      </div>
    </div>`;
}

function resumo() {
  const c = calcular();
  if (!c) return `<div class="mu">Escolha as datas de retirada e devolução para ver o valor.</div><button class="btn p" disabled>Solicitar reserva</button>`;
  return `
    <div class="row"><span>${dinheiro(sel.preco_dia)} × ${c.dias} diária${c.dias > 1 ? 's' : ''}</span><span>${dinheiro(c.subtotal)}</span></div>
    <div class="row"><span>Taxa da plataforma</span><span>${dinheiro(c.taxa)}</span></div>
    <div class="row"><span>Proteção completa</span><span>${dinheiro(c.extra)}</span></div>
    <div class="row tot"><span>Total</span><span>${dinheiro(c.total)}</span></div>
    <div class="mu">Você só paga se o proprietário aceitar. Ao solicitar, você assina o contrato.</div>
    <button class="btn p" data-acao="solicitar" ${pedido.aceito ? '' : 'disabled'}>Solicitar reserva</button>`;
}

function telaReservas() {
  if (!reservas.length) return `<div class="vazio">Você ainda não fez nenhuma reserva.<br><br><button class="btn p" data-acao="aba" data-aba="buscar">Buscar carros</button></div>`;
  return `<div class="list">${reservas.map(r => `
    <div class="box">
      <div class="row"><h3>${esc(r.veiculo?.modelo || 'Carro removido')}</h3><span class="st ${r.status}">${STATUS[r.status]}</span></div>
      <div class="mu">${dataBR(r.data_inicio)} a ${dataBR(r.data_fim)} · ${dinheiro(r.total)} · ${esc(r.veiculo?.dono?.nome)}</div>
      <div class="row" style="justify-content:flex-start">
        ${r.contrato ? `<button class="btn s" data-acao="contrato" data-id="${r.id}">Ver contrato</button>` : ''}
        ${r.status === 'pendente' || r.status === 'aceita' ? `<button class="btn s" data-acao="cancelar" data-id="${r.id}">Cancelar</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

// ---------------- Telas: anunciar ----------------
function telaRecebidas() {
  const aceitas = recebidas.filter(r => r.status === 'aceita');
  const pendentes = recebidas.filter(r => r.status === 'pendente');
  const ganhos = aceitas.reduce((s, r) => s + Number(r.subtotal), 0);
  const lista = [...pendentes, ...recebidas.filter(r => r.status !== 'pendente')];
  return `
    <div class="kpis">
      <div class="box kpi"><span class="mu">Ganhos confirmados</span><b>${dinheiro(ganhos)}</b></div>
      <div class="box kpi"><span class="mu">Pedidos pendentes</span><b>${pendentes.length}</b></div>
      <div class="box kpi"><span class="mu">Reservas confirmadas</span><b>${aceitas.length}</b></div>
    </div>
    ${lista.length ? `<div class="list">${lista.map(r => `
      <div class="box">
        <div class="row"><h3>${esc(r.locatario?.nome)}</h3><span class="st ${r.status}">${STATUS[r.status]}</span></div>
        <div class="mu">${esc(r.veiculo.modelo)} · ${dataBR(r.data_inicio)} a ${dataBR(r.data_fim)} · ${dinheiro(r.subtotal)}</div>
        <div class="row" style="justify-content:flex-start">
          ${r.contrato ? `<button class="btn s" data-acao="contrato" data-id="${r.id}">Ver contrato</button>` : ''}
          ${r.status === 'pendente' ? `
            <button class="btn s p" data-acao="aceitar" data-id="${r.id}">Aceitar e assinar</button>
            <button class="btn s" data-acao="recusar" data-id="${r.id}">Recusar</button>` : ''}
        </div>
      </div>`).join('')}</div>`
    : `<div class="vazio">Nenhum pedido por enquanto. Quando alguém pedir um dos seus carros, ele aparece aqui.</div>`}`;
}

function telaCarros() {
  const aviso = doc ? '' : `<div class="aviso-box">Para anunciar, complete seu perfil com CPF e telefone. ${botaoPerfil}</div>`;
  const lista = meusCarros.length ? meusCarros.map(v => `
    <div class="box">
      <div class="row"><h3>${esc(v.modelo)}</h3><span class="st ${v.ativo ? 'ativo' : 'pendente'}">${v.ativo ? 'Anúncio ativo' : 'Pausado'}</span></div>
      <div class="mu">${esc(v.cidade)} · ${v.tipo} · ${v.cambio} · ${v.lugares} lugares · ${dinheiro(v.preco_dia)} / dia${v.placa ? ' · ' + esc(v.placa) : ''}</div>
      <div class="fotos-edit">
        ${(v.fotos || []).map((f, i) => `<div class="item"><img src="${esc(f)}" alt="Foto ${i + 1}"><button class="x" data-acao="rmfoto" data-id="${v.id}" data-i="${i}" aria-label="Remover foto ${i + 1}">×</button></div>`).join('')}
        ${(v.fotos || []).length < MAX_FOTOS ? `<button class="btn s" data-acao="addfoto" data-id="${v.id}">+ Adicionar fotos</button>
          <input type="file" hidden accept="image/jpeg,image/png,image/webp" multiple data-addfotos="${v.id}">` : ''}
      </div>
      <div class="row" style="justify-content:flex-start">
        <button class="btn s" data-acao="alternar" data-id="${v.id}">${v.ativo ? 'Pausar anúncio' : 'Reativar anúncio'}</button>
        <button class="btn s" data-acao="remover" data-id="${v.id}">Remover</button>
      </div>
    </div>`).join('') : `<div class="vazio">Você ainda não anunciou nenhum carro.</div>`;

  return `
    <div class="lado">
      <div class="list">${lista}</div>
      <form class="box" id="form-anuncio">
        <h3>Anunciar carro</h3>
        ${aviso}
        <label class="fld">Modelo e ano <input name="modelo" required placeholder="Ex.: Volkswagen Polo 2021"></label>
        <div class="duas">
          <label class="fld">Placa <input name="placa" required maxlength="8" placeholder="ABC1D23"></label>
          <label class="fld">Cidade <input name="cidade" required placeholder="São Paulo"></label>
        </div>
        <div class="duas">
          <label class="fld">Tipo <select name="tipo"><option>Compacto</option><option>Sedã</option><option>SUV</option><option>Minivan</option></select></label>
          <label class="fld">Câmbio <select name="cambio"><option>Manual</option><option>Automático</option></select></label>
        </div>
        <div class="duas">
          <label class="fld">Lugares <input name="lugares" type="number" min="2" max="9" value="5" required></label>
          <label class="fld">Preço / dia (R$) <input name="preco_dia" type="number" min="1" step="0.01" required placeholder="120"></label>
        </div>
        <label class="fld">Valor de referência do carro (R$)
          <input name="valor_referencia" type="number" min="1" step="0.01" required placeholder="Ex.: tabela FIPE">
        </label>
        <label class="fld">Fotos (até ${MAX_FOTOS}, JPG, PNG ou WebP)
          <input name="fotos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
        </label>
        <button class="btn p" type="submit">Publicar anúncio</button>
      </form>
    </div>`;
}

// ---------------- Perfil ----------------
function telaPerfil() {
  return `
    <form class="box" id="form-perfil" style="max-width:520px">
      <h2>Meu perfil</h2>
      <p class="mu">CPF, telefone e CNH aparecem no contrato de locação. Somente você vê esses dados no seu perfil.</p>
      <label class="fld">Nome <input name="nome" required value="${esc(perfil.nome)}"></label>
      <label class="fld">CPF (só números) <input name="cpf" required inputmode="numeric" maxlength="14" value="${esc(doc?.cpf || '')}"></label>
      <label class="fld">Telefone com DDD <input name="telefone" required inputmode="tel" maxlength="16" value="${esc(doc?.telefone || '')}"></label>
      <label class="fld">Número da CNH (necessário para alugar) <input name="cnh" inputmode="numeric" maxlength="11" value="${esc(doc?.cnh || '')}"></label>
      <button class="btn p" type="submit">Salvar perfil</button>
    </form>`;
}

function render() {
  const telas = { buscar: telaBusca, detalhe: telaDetalhe, reservas: telaReservas, recebidas: telaRecebidas, carros: telaCarros, perfil: telaPerfil };
  $('#conteudo').innerHTML = telas[aba]();
  document.querySelectorAll('.modo button').forEach(b => b.setAttribute('aria-pressed', b.dataset.modo === modo));
  const pend = recebidas.filter(r => r.status === 'pendente').length;
  $('#abas').innerHTML = ABAS[modo].map(([k, l]) =>
    `<button data-acao="aba" data-aba="${k}" aria-current="${aba === k || (aba === 'detalhe' && k === 'buscar')}">${l}${k === 'recebidas' && pend ? `<span class="n">${pend}</span>` : ''}</button>`).join('');
}

function abrirContrato(titulo, texto, rodape) {
  $('#dlg-titulo').textContent = titulo;
  $('#dlg-texto').textContent = texto + (rodape ? '\n\n' + rodape : '');
  $('#dlg').showModal();
}

// ---------------- Fotos ----------------
async function enviarFotos(arquivos) {
  const urls = [];
  try {
    for (const arq of arquivos) {
      const blob = await reduzirImagem(arq);
      const caminho = `${usuario.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from('veiculos').upload(caminho, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      urls.push(sb.storage.from('veiculos').getPublicUrl(caminho).data.publicUrl);
    }
  } catch (e) {
    await apagarFotos(urls);
    throw e;
  }
  return urls;
}

async function apagarFotos(urls) {
  const caminhos = urls.map(caminhoDaFoto).filter(Boolean);
  if (caminhos.length) await sb.storage.from('veiculos').remove(caminhos).catch(() => {});
}

// ---------------- Ações ----------------
document.addEventListener('click', async (e) => {
  const alvo = e.target.closest('[data-acao]');
  if (!alvo) return;
  const acao = alvo.dataset.acao, id = alvo.dataset.id;
  const meuCarro = () => meusCarros.find(x => x.id === id);

  if (acao === 'fechar') return $('#dlg').close();
  if (acao === 'imprimir') return window.print();
  if (acao === 'addfoto') return document.querySelector(`[data-addfotos="${id}"]`).click();

  if (acao === 'modo') { modo = alvo.dataset.modo; aba = ABAS[modo][0][0]; sel = null; }

  if (acao === 'aba') {
    aba = alvo.dataset.aba; sel = null;
    if (ABAS.alugar.some(([k]) => k === aba)) modo = 'alugar';
    if (ABAS.anunciar.some(([k]) => k === aba)) modo = 'anunciar';
  }

  if (acao === 'abrir') {
    sel = veiculos.find(v => v.id === id);
    pedido = { inicio: '', fim: '', protecao: 'basica', aceito: false };
    fotoIdx = 0; aba = 'detalhe';
  }
  if (acao === 'voltar') aba = 'buscar';
  if (acao === 'foto') fotoIdx = Number(alvo.dataset.i);

  if (acao === 'previa') {
    if (!calcular()) return toast('Escolha as datas de retirada e devolução primeiro.');
    const { data, error } = await sb.rpc('previa_contrato', {
      p_veiculo: sel.id, p_inicio: pedido.inicio, p_fim: pedido.fim, p_protecao: pedido.protecao
    });
    if (error) return toast(error.message);
    return abrirContrato('Contrato de locação (prévia)', data,
      'Nesta prévia o CPF do proprietário aparece parcialmente oculto. O contrato final é gerado quando você envia o pedido.');
  }

  if (acao === 'solicitar') {
    if (!calcular() || !pedido.aceito) return;
    if (!doc?.cnh) { toast('Complete seu perfil (CPF, telefone e CNH) antes de reservar.'); aba = 'perfil'; return render(); }
    alvo.disabled = true;
    // subtotal e total são recalculados pelo banco; o contrato também é gerado lá
    const { error } = await sb.from('reservas').insert({
      veiculo_id: sel.id, data_inicio: pedido.inicio, data_fim: pedido.fim,
      protecao: pedido.protecao, subtotal: 0, total: 0
    });
    if (error) { toast('Erro ao reservar: ' + error.message); alvo.disabled = false; return; }
    toast('Pedido enviado e contrato assinado por você. Você só paga se o proprietário aceitar.');
    await carregar();
    aba = 'reservas'; sel = null;
  }

  if (acao === 'contrato') {
    const r = [...reservas, ...recebidas].find(x => x.id === id);
    return abrirContrato('Contrato de locação', r.contrato,
      `Aceite do locatário: ${dataHora(r.locatario_aceite_em)}\nAceite do locador: ${r.dono_aceite_em ? dataHora(r.dono_aceite_em) : 'aguardando'}`);
  }

  if (acao === 'cancelar') {
    if (!confirm('Cancelar esta reserva?')) return;
    const { error } = await sb.from('reservas').update({ status: 'cancelada' }).eq('id', id);
    if (error) return toast('Erro: ' + error.message);
    toast('Reserva cancelada.');
    await carregar();
  }

  if (acao === 'aceitar' || acao === 'recusar') {
    if (acao === 'aceitar' && !confirm('Ao aceitar, você assina eletronicamente o contrato de locação deste pedido. Continuar?')) return;
    const status = acao === 'aceitar' ? 'aceita' : 'recusada';
    const { error } = await sb.from('reservas').update({ status }).eq('id', id);
    if (error) {
      toast(error.code === '23P01' ? 'Já existe uma reserva confirmada nessas datas. Recuse este pedido.' : 'Erro: ' + error.message);
      return;
    }
    toast(status === 'aceita' ? 'Reserva confirmada e contrato assinado.' : 'Pedido recusado.');
    await carregar();
  }

  if (acao === 'alternar') {
    const { error } = await sb.from('veiculos').update({ ativo: !meuCarro().ativo }).eq('id', id);
    if (error) return toast('Erro: ' + error.message);
    await carregar();
  }

  if (acao === 'remover') {
    if (!confirm('Remover este carro? As reservas dele também serão apagadas.')) return;
    const fotos = meuCarro().fotos || [];
    const { error } = await sb.from('veiculos').delete().eq('id', id);
    if (error) return toast('Erro: ' + error.message);
    await apagarFotos(fotos);
    toast('Carro removido.');
    await carregar();
  }

  if (acao === 'rmfoto') {
    const v = meuCarro(), i = Number(alvo.dataset.i);
    const { error } = await sb.from('veiculos').update({ fotos: v.fotos.filter((_, k) => k !== i) }).eq('id', id);
    if (error) return toast('Erro: ' + error.message);
    await apagarFotos([v.fotos[i]]);
    await carregar();
  }

  render();
});

document.addEventListener('input', (e) => {
  const c = e.target;
  if (c.dataset.filtro) { filtro[c.dataset.filtro] = c.value; $('#resultados').innerHTML = listaCarros(); }
  if (c.dataset.pedido && c.type !== 'checkbox') { pedido[c.dataset.pedido] = c.value; $('#resumo').innerHTML = resumo(); }
});

document.addEventListener('change', async (e) => {
  const c = e.target;
  if (c.dataset.pedido && c.type === 'checkbox') { pedido.aceito = c.checked; $('#resumo').innerHTML = resumo(); }
  if (c.dataset.addfotos) {
    const v = meusCarros.find(x => x.id === c.dataset.addfotos), arquivos = [...c.files];
    if (!arquivos.length) return;
    if ((v.fotos || []).length + arquivos.length > MAX_FOTOS) return toast(`Cada anúncio pode ter no máximo ${MAX_FOTOS} fotos.`);
    toast('Enviando fotos…');
    try {
      const urls = await enviarFotos(arquivos);
      const { error } = await sb.from('veiculos').update({ fotos: [...(v.fotos || []), ...urls] }).eq('id', v.id);
      if (error) { await apagarFotos(urls); throw error; }
      await carregar(); render();
    } catch (err) { toast('Erro ao enviar fotos: ' + err.message); }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (form.id !== 'form-perfil' && form.id !== 'form-anuncio') return;
  e.preventDefault();
  const f = new FormData(form), botao = e.submitter;

  if (form.id === 'form-perfil') {
    const nome = f.get('nome').trim(), cpf = somenteDigitos(f.get('cpf'));
    const tel = somenteDigitos(f.get('telefone')), cnh = somenteDigitos(f.get('cnh'));
    if (!validarCPF(cpf)) return toast('CPF inválido.');
    if (tel.length < 10 || tel.length > 11) return toast('Telefone inválido. Informe DDD e número.');
    if (cnh && (cnh.length < 9 || cnh.length > 11)) return toast('CNH inválida.');
    botao.disabled = true;
    const a = await sb.from('perfis').update({ nome }).eq('id', usuario.id);
    const b = await sb.from('documentos').upsert({ id: usuario.id, cpf, telefone: tel, cnh: cnh || null, updated_at: new Date().toISOString() });
    botao.disabled = false;
    if (a.error || b.error) return toast('Erro ao salvar: ' + (a.error || b.error).message);
    perfil.nome = nome; $('#usuario-nome').textContent = nome;
    await carregar(); render();
    return toast('Perfil salvo.');
  }

  // form-anuncio
  if (!doc) { toast('Complete seu perfil (CPF e telefone) antes de anunciar.'); aba = 'perfil'; return render(); }
  const placa = f.get('placa').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) return toast('Placa inválida. Exemplo: ABC1D23.');
  const arquivos = [...form.querySelector('input[type=file]').files];
  if (arquivos.length > MAX_FOTOS) return toast(`No máximo ${MAX_FOTOS} fotos.`);

  botao.disabled = true;
  let urls = [];
  try {
    urls = await enviarFotos(arquivos);
    const { error } = await sb.from('veiculos').insert({
      modelo: f.get('modelo').trim(), placa, cidade: f.get('cidade').trim(),
      tipo: f.get('tipo'), cambio: f.get('cambio'), lugares: Number(f.get('lugares')),
      preco_dia: Number(f.get('preco_dia')), valor_referencia: Number(f.get('valor_referencia')), fotos: urls
    });
    if (error) throw error;
  } catch (err) {
    await apagarFotos(urls);
    botao.disabled = false;
    return toast('Erro ao publicar: ' + err.message);
  }
  toast('Anúncio publicado!');
  await carregar(); render();
});

iniciar();
