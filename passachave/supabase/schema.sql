-- =====================================================================
-- Passachave – banco de dados (Supabase / PostgreSQL)
-- Cole tudo no SQL Editor e clique em "Run".
-- Pode ser executado em um projeto novo OU no projeto que já tinha a versão
-- anterior (perfis com "tipo"): o script migra sem apagar usuários, carros e reservas.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- PERFIS: nome público de cada usuário. Uma conta serve para alugar e anunciar.
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  created_at  timestamptz not null default now()
);

create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)));
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- DOCUMENTOS: dados privados usados no contrato (só o próprio usuário lê).
-- ---------------------------------------------------------------------
create table if not exists public.documentos (
  id          uuid primary key references public.perfis(id) on delete cascade,
  cpf         text not null check (cpf ~ '^[0-9]{11}$'),
  telefone    text not null check (telefone ~ '^[0-9]{10,11}$'),
  cnh         text check (cnh is null or cnh ~ '^[0-9]{9,11}$'),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- VEÍCULOS
-- ---------------------------------------------------------------------
create table if not exists public.veiculos (
  id          uuid primary key default gen_random_uuid(),
  dono_id     uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  modelo      text not null,
  tipo        text not null check (tipo in ('Compacto', 'Sedã', 'SUV', 'Minivan')),
  cidade      text not null,
  cambio      text not null default 'Manual' check (cambio in ('Manual', 'Automático')),
  lugares     int  not null default 5 check (lugares between 2 and 9),
  preco_dia   numeric(10,2) not null check (preco_dia > 0),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.veiculos add column if not exists placa text;
alter table public.veiculos add column if not exists valor_referencia numeric(12,2);
alter table public.veiculos add column if not exists fotos text[] not null default '{}';
alter table public.veiculos drop constraint if exists veiculos_placa_check;
alter table public.veiculos add constraint veiculos_placa_check
  check (placa is null or placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');
alter table public.veiculos drop constraint if exists veiculos_valor_ref_check;
alter table public.veiculos add constraint veiculos_valor_ref_check
  check (valor_referencia is null or valor_referencia > 0);
alter table public.veiculos drop constraint if exists veiculos_fotos_max;
alter table public.veiculos add constraint veiculos_fotos_max check (cardinality(fotos) <= 6);

-- ---------------------------------------------------------------------
-- RESERVAS (status: pendente -> aceita / recusada pelo dono, ou cancelada pelo locatário)
-- ---------------------------------------------------------------------
create table if not exists public.reservas (
  id            uuid primary key default gen_random_uuid(),
  veiculo_id    uuid not null references public.veiculos(id) on delete cascade,
  locatario_id  uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  data_inicio   date not null,
  data_fim      date not null check (data_fim > data_inicio),
  subtotal      numeric(10,2) not null,
  total         numeric(10,2) not null,
  status        text not null default 'pendente'
                check (status in ('pendente', 'aceita', 'recusada', 'cancelada')),
  created_at    timestamptz not null default now(),
  constraint sem_conflito exclude using gist (
    veiculo_id with =, daterange(data_inicio, data_fim) with &&
  ) where (status = 'aceita')
);
alter table public.reservas add column if not exists protecao text not null default 'basica';
alter table public.reservas drop constraint if exists reservas_protecao_check;
alter table public.reservas add constraint reservas_protecao_check check (protecao in ('basica', 'completa'));
alter table public.reservas add column if not exists contrato text;
alter table public.reservas add column if not exists locatario_aceite_em timestamptz;
alter table public.reservas add column if not exists dono_aceite_em timestamptz;

-- ---------------------------------------------------------------------
-- Remove o antigo "tipo de conta" (policy e trigger antigos dependiam dele)
-- ---------------------------------------------------------------------
drop policy if exists "veiculos_criar" on public.veiculos;
alter table public.perfis drop column if exists tipo;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.criar_perfil();

-- ---------------------------------------------------------------------
-- CONTRATO: texto montado no banco, a partir dos dados reais da reserva.
-- O locatário não consegue alterá-lo.
-- ---------------------------------------------------------------------
create or replace function public.brl(n numeric) returns text
language sql immutable as $$ select 'R$ ' || replace(to_char(n, 'FM999999990.00'), '.', ',') $$;

create or replace function public.fmt_cpf(c text) returns text
language sql immutable as $$
  select substr(c,1,3) || '.' || substr(c,4,3) || '.' || substr(c,7,3) || '-' || substr(c,10,2) $$;

create or replace function public.mascara_cpf(c text) returns text
language sql immutable as $$ select '***.' || substr(c,4,3) || '.***-**' $$;

create or replace function public.montar_contrato(
  p_veiculo uuid, p_locatario uuid, p_inicio date, p_fim date, p_protecao text, p_mascarar boolean
) returns text language plpgsql security definer set search_path = public as $$
declare
  v public.veiculos%rowtype; dono public.perfis%rowtype; loc public.perfis%rowtype;
  dd public.documentos%rowtype; dl public.documentos%rowtype;
  dias int; sub numeric; taxa numeric; prot numeric; tot numeric;
  rotulo text; ref text; cpf_dono text;
begin
  select * into v from public.veiculos where id = p_veiculo;
  if not found then raise exception 'Veículo não encontrado.'; end if;
  select * into dono from public.perfis where id = v.dono_id;
  select * into loc  from public.perfis where id = p_locatario;
  select * into dd from public.documentos where id = v.dono_id;
  if not found then raise exception 'O proprietário ainda não completou o cadastro.'; end if;
  select * into dl from public.documentos where id = p_locatario;
  if not found or dl.cnh is null then
    raise exception 'Complete seu perfil (CPF, telefone e CNH) antes de reservar.';
  end if;

  dias := p_fim - p_inicio;
  if dias < 1 then raise exception 'A devolução deve ser depois da retirada.'; end if;
  sub  := dias * v.preco_dia;
  taxa := round(sub * 0.12, 2);
  prot := case when p_protecao = 'completa' then dias * 18 else 0 end;
  tot  := sub + taxa + prot;
  rotulo := case when p_protecao = 'completa' then 'completa' else 'básica' end;
  ref := case when v.valor_referencia is null then 'não informado' else public.brl(v.valor_referencia) end;
  cpf_dono := case when p_mascarar then public.mascara_cpf(dd.cpf) else public.fmt_cpf(dd.cpf) end;

  return format($c$CONTRATO DE LOCAÇÃO DE VEÍCULO ENTRE PESSOAS FÍSICAS

CLÁUSULA 1 – DAS PARTES
LOCADOR: %5$s, CPF %6$s.
LOCATÁRIO: %1$s, CPF %2$s, CNH nº %3$s, telefone %4$s.
A plataforma Passachave apenas aproxima as partes e não é parte deste contrato.

CLÁUSULA 2 – DO OBJETO
Locação do veículo %7$s, placa %8$s, localizado em %9$s, com valor de referência de %10$s.

CLÁUSULA 3 – DO PRAZO E DO PREÇO
3.1 Período: de %11$s a %12$s (%13$s diária(s) de %14$s).
3.2 Subtotal das diárias: %15$s. Taxa da plataforma: %16$s. Proteção %17$s: %18$s. Total: %19$s.
3.3 O pedido só se torna reserva depois do aceite do locador.
3.4 A devolução fora do prazo gera cobrança de diária adicional por dia ou fração de atraso, sem prejuízo de perdas e danos.

CLÁUSULA 4 – DAS OBRIGAÇÕES DO LOCATÁRIO
a) Conduzir o veículo pessoalmente, com CNH válida e categoria compatível, e não o emprestar a terceiros sem autorização escrita do locador.
b) Usá-lo apenas de forma lícita e conforme a legislação de trânsito, sendo vedados: sublocação, transporte remunerado de passageiros ou cargas, competições e condução sob efeito de álcool ou outras substâncias.
c) Devolvê-lo no local e na data combinados, no mesmo estado e com o mesmo nível de combustível da retirada, ressalvado o desgaste natural.
d) Arcar com combustível, pedágios, estacionamento e lavagem durante o período.

CLÁUSULA 5 – DAS INFRAÇÕES DE TRÂNSITO
5.1 O LOCATÁRIO É O ÚNICO RESPONSÁVEL por multas, pontuação e demais penalidades decorrentes de infrações cometidas entre a retirada e a devolução do veículo, incluindo pedágios não pagos, estacionamento irregular, guincho e remoção.
5.2 O locador poderá indicar o locatário como condutor infrator perante o órgão de trânsito (art. 257 do Código de Trânsito Brasileiro). O locatário autoriza o fornecimento de seus dados (nome, CPF e CNH) para essa finalidade e se compromete a assinar os documentos necessários.
5.3 Infrações cometidas durante o período, ainda que notificadas depois da devolução, continuam sob responsabilidade do locatário.
5.4 O locatário reembolsará o locador em até 10 dias contados da comunicação, mediante cópia da notificação. Em caso de atraso, incidem multa de 2%% e juros de 1%% ao mês. O locador que pagar a multa para evitar encargos tem direito de regresso.

CLÁUSULA 6 – DOS DANOS, FURTO E ROUBO
6.1 O LOCATÁRIO RESPONDE por todos os danos ao veículo ocorridos durante o período (colisões, avarias, perda de acessórios, danos internos), ressalvados o desgaste natural e os danos já existentes na retirada.
6.2 A indenização corresponde ao custo do reparo, comprovado por orçamento ou nota fiscal de oficina idônea, mais o valor da diária contratada pelos dias em que o veículo ficar indisponível para reparo, limitados a 30 dias.
6.3 Em caso de perda total, furto ou roubo enquanto o veículo estiver sob guarda do locatário, este responde até o valor de referência de %10$s, salvo se provar que adotou os cuidados devidos (guarda segura, trancas e chaves) e comunicou o fato de imediato.
6.4 Em caso de acidente, furto, roubo ou qualquer sinistro, o locatário deve avisar o locador imediatamente, registrar boletim de ocorrência em até 24 horas e não fazer reparos sem autorização.
6.5 A proteção escolhida (%17$s) não substitui seguro. Eventual cobertura depende de apólice contratada e não afasta a responsabilidade do locatário perante o locador, nos termos desta cláusula.

CLÁUSULA 7 – DA VISTORIA
Na retirada e na devolução, as partes registrarão o estado do veículo com fotos de todos os lados, painel (hodômetro) e nível de combustível. Sem registro na retirada, presume-se que o veículo estava em bom estado.

CLÁUSULA 8 – DO CANCELAMENTO
O cancelamento antes da retirada deve ser feito pelo sistema. Valores eventualmente pagos diretamente entre as partes serão por elas acertados.

CLÁUSULA 9 – DA PLATAFORMA
A Passachave não é seguradora, não garante o pagamento de multas ou indenizações e não responde por danos ou infrações. A cobrança dessas quantias é feita diretamente entre locador e locatário.

CLÁUSULA 10 – DA ASSINATURA ELETRÔNICA E DO FORO
As partes reconhecem o aceite eletrônico, com registro de data e hora no sistema, como manifestação de vontade e assinatura deste contrato. Fica eleito o foro da comarca de %9$s.$c$,
    loc.nome, public.fmt_cpf(dl.cpf), dl.cnh, dl.telefone,
    dono.nome, cpf_dono,
    v.modelo, coalesce(v.placa, 'não informada'), v.cidade, ref,
    to_char(p_inicio, 'DD/MM/YYYY'), to_char(p_fim, 'DD/MM/YYYY'), dias, public.brl(v.preco_dia),
    public.brl(sub), public.brl(taxa), rotulo, public.brl(prot), public.brl(tot));
end;
$$;
revoke all on function public.montar_contrato(uuid, uuid, date, date, text, boolean) from public, anon, authenticated;

-- Prévia do contrato (CPF do dono parcialmente oculto), chamada pela tela de detalhe
create or replace function public.previa_contrato(p_veiculo uuid, p_inicio date, p_fim date, p_protecao text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  return public.montar_contrato(p_veiculo, auth.uid(), p_inicio, p_fim, p_protecao, true);
end;
$$;
revoke all on function public.previa_contrato(uuid, date, date, text) from public, anon;
grant execute on function public.previa_contrato(uuid, date, date, text) to authenticated;

-- Ao criar a reserva: valida, recalcula os valores e grava o contrato com o aceite do locatário
create or replace function public.reserva_antes_inserir()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.veiculos%rowtype; dias int;
begin
  select * into v from public.veiculos where id = new.veiculo_id;
  if not found or not v.ativo then raise exception 'Este anúncio não está disponível.'; end if;
  if v.dono_id = new.locatario_id then raise exception 'Você não pode reservar o seu próprio carro.'; end if;
  if new.data_inicio < current_date then raise exception 'A retirada não pode ser no passado.'; end if;
  dias := new.data_fim - new.data_inicio;
  new.subtotal := dias * v.preco_dia;
  new.total := new.subtotal + round(new.subtotal * 0.12, 2)
               + case when new.protecao = 'completa' then dias * 18 else 0 end;
  new.status := 'pendente';
  new.contrato := public.montar_contrato(new.veiculo_id, new.locatario_id, new.data_inicio, new.data_fim, new.protecao, false);
  new.locatario_aceite_em := now();
  new.dono_aceite_em := null;
  return new;
end;
$$;
drop trigger if exists reserva_inserir on public.reservas;
create trigger reserva_inserir before insert on public.reservas
  for each row execute function public.reserva_antes_inserir();

-- Ao atualizar: só o status pode mudar; o aceite do dono é registrado aqui
create or replace function public.reserva_antes_atualizar()
returns trigger language plpgsql as $$
begin
  if new.veiculo_id <> old.veiculo_id or new.locatario_id <> old.locatario_id
     or new.data_inicio <> old.data_inicio or new.data_fim <> old.data_fim
     or new.subtotal <> old.subtotal or new.total <> old.total or new.protecao <> old.protecao
     or new.contrato is distinct from old.contrato
     or new.locatario_aceite_em is distinct from old.locatario_aceite_em
     or new.dono_aceite_em is distinct from old.dono_aceite_em then
    raise exception 'Somente o status da reserva pode ser alterado.';
  end if;
  if new.status <> old.status then
    if old.status in ('recusada', 'cancelada') or (old.status = 'aceita' and new.status <> 'cancelada') then
      raise exception 'Esta reserva já foi encerrada ou confirmada.';
    end if;
    if new.status = 'aceita' then new.dono_aceite_em := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists reserva_atualizar on public.reservas;
create trigger reserva_atualizar before update on public.reservas
  for each row execute function public.reserva_antes_atualizar();

-- ---------------------------------------------------------------------
-- SEGURANÇA (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.perfis     enable row level security;
alter table public.documentos enable row level security;
alter table public.veiculos   enable row level security;
alter table public.reservas   enable row level security;

drop policy if exists "perfis_ver" on public.perfis;
create policy "perfis_ver" on public.perfis for select to anon, authenticated using (true);
drop policy if exists "perfis_editar" on public.perfis;
create policy "perfis_editar" on public.perfis for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "documentos_ver" on public.documentos;
create policy "documentos_ver" on public.documentos for select to authenticated using (id = auth.uid());
drop policy if exists "documentos_criar" on public.documentos;
create policy "documentos_criar" on public.documentos for insert to authenticated with check (id = auth.uid());
drop policy if exists "documentos_editar" on public.documentos;
create policy "documentos_editar" on public.documentos for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Qualquer conta pode anunciar, desde que tenha completado CPF e telefone
drop policy if exists "veiculos_ver" on public.veiculos;
create policy "veiculos_ver" on public.veiculos for select to anon, authenticated
  using (ativo or dono_id = auth.uid());
create policy "veiculos_criar" on public.veiculos for insert to authenticated
  with check (dono_id = auth.uid() and exists (select 1 from public.documentos d where d.id = auth.uid()));
drop policy if exists "veiculos_editar" on public.veiculos;
create policy "veiculos_editar" on public.veiculos for update to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());
drop policy if exists "veiculos_apagar" on public.veiculos;
create policy "veiculos_apagar" on public.veiculos for delete to authenticated using (dono_id = auth.uid());

drop policy if exists "reservas_ver" on public.reservas;
create policy "reservas_ver" on public.reservas for select to authenticated using (
  locatario_id = auth.uid()
  or exists (select 1 from public.veiculos v where v.id = veiculo_id and v.dono_id = auth.uid()));
drop policy if exists "reservas_criar" on public.reservas;
create policy "reservas_criar" on public.reservas for insert to authenticated
  with check (locatario_id = auth.uid() and status = 'pendente');
drop policy if exists "reservas_locatario_editar" on public.reservas;
create policy "reservas_locatario_editar" on public.reservas for update to authenticated
  using (locatario_id = auth.uid())
  with check (locatario_id = auth.uid() and status in ('pendente', 'cancelada'));
drop policy if exists "reservas_dono_editar" on public.reservas;
create policy "reservas_dono_editar" on public.reservas for update to authenticated
  using (exists (select 1 from public.veiculos v where v.id = veiculo_id and v.dono_id = auth.uid()))
  with check (status in ('aceita', 'recusada'));

-- ---------------------------------------------------------------------
-- STORAGE: bucket público "veiculos" para as fotos dos anúncios.
-- Cada usuário só envia e apaga arquivos dentro da pasta com o seu id.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('veiculos', 'veiculos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "fotos_enviar" on storage.objects;
create policy "fotos_enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'veiculos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "fotos_apagar" on storage.objects;
create policy "fotos_apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'veiculos' and (storage.foldername(name))[1] = auth.uid()::text);
