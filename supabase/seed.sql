-- Carros de exemplo (fictícios). Pré-requisito: existir pelo menos uma conta cadastrada.
-- Os carros ficam no nome da conta mais antiga; para vê-los na busca, entre com OUTRA conta
-- (ninguém aluga o próprio carro). Execute no SQL Editor do Supabase.
do $$
declare dono uuid;
begin
  select id into dono from public.perfis order by created_at limit 1;
  if dono is null then raise exception 'Cadastre uma conta antes de rodar este script.'; end if;
  insert into public.veiculos (dono_id, modelo, placa, tipo, cidade, cambio, lugares, preco_dia, valor_referencia) values
    (dono, 'Honda Civic 2019',          'ABC1D23', 'Sedã',     'São Paulo', 'Automático', 5, 180.00,  95000),
    (dono, 'Fiat Mobi 2021',            'BCD2E34', 'Compacto', 'São Paulo', 'Manual',     4,  95.00,  52000),
    (dono, 'Jeep Renegade 2020',        'CDE3F45', 'SUV',      'Campinas',  'Automático', 5, 210.00,  98000),
    (dono, 'Chevrolet Spin 2018',       'DEF4G56', 'Minivan',  'São Paulo', 'Manual',     7, 150.00,  68000),
    (dono, 'Toyota Corolla Cross 2022', 'EFG5H67', 'SUV',      'Santos',    'Automático', 5, 260.00, 150000),
    (dono, 'Renault Kwid 2022',         'FGH6I78', 'Compacto', 'Campinas',  'Manual',     4,  80.00,  50000);
end $$;
