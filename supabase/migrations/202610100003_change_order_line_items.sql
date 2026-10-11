alter table public.project_change_orders
  add column line_items jsonb,
  add column contract_time_adjustment_days integer not null default 0;

update public.project_change_orders
set line_items = jsonb_build_array(jsonb_build_object(
  'item', title,
  'description', coalesce(description, ''),
  'remarks', '',
  'cost', amount
))
where line_items is null;

alter table public.project_change_orders
  alter column line_items set not null,
  add constraint project_change_orders_line_items_array
    check (jsonb_typeof(line_items) = 'array');

drop function public.create_project_change_order(uuid, text, text, numeric);

create function public.create_project_change_order(
  p_project_id uuid,
  p_line_items jsonb,
  p_contract_time_adjustment_days integer
)
returns table(id uuid, order_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  project_organization_id uuid;
  next_order_number integer;
  new_change_order_id uuid;
  line_item jsonb;
  line_number integer := 0;
  total_amount numeric := 0;
  normalized_title text;
begin
  if actor_id is null then raise exception 'Authentication is required.'; end if;
  select project.organization_id into project_organization_id
  from public.projects project
  where project.id = p_project_id
  for update;
  if project_organization_id is null then raise exception 'Project was not found.'; end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to add change orders to this project.';
  end if;
  if p_line_items is null or jsonb_typeof(p_line_items) is distinct from 'array' then
    raise exception 'Change-order items must be provided as a list.';
  end if;
  if jsonb_array_length(p_line_items) = 0 or jsonb_array_length(p_line_items) > 100 then
    raise exception 'Add between one and 100 change-order items.';
  end if;
  if p_contract_time_adjustment_days is null then
    raise exception 'Contract time adjustment must be entered in whole days.';
  end if;

  for line_item in select line_items.value from jsonb_array_elements(p_line_items) as line_items(value)
  loop
    line_number := line_number + 1;
    if jsonb_typeof(line_item) <> 'object'
       or length(trim(coalesce(line_item ->> 'item', ''))) not between 1 and 150
       or length(coalesce(line_item ->> 'description', '')) > 2000
       or length(coalesce(line_item ->> 'remarks', '')) > 2000 then
      raise exception 'Change-order item % has invalid item, description, or remarks.', line_number;
    end if;
    begin
      if coalesce(line_item ->> 'cost', '') = '' then
        raise exception 'Cost is required.';
      end if;
      if (line_item ->> 'cost')::numeric <= 0
         or (line_item ->> 'cost')::numeric = 'NaN'::numeric
         or (line_item ->> 'cost')::numeric > 999999999999.99 then
        raise exception 'Cost must be greater than zero and within the supported range.';
      end if;
      total_amount := total_amount + (line_item ->> 'cost')::numeric;
    exception when invalid_text_representation then
      raise exception 'Change-order item % must have a valid numeric cost.', line_number;
    end;
  end loop;
  if total_amount > 999999999999.99 then
    raise exception 'The change-order total exceeds the supported amount.';
  end if;

  normalized_title := trim(p_line_items -> 0 ->> 'item');

  select coalesce(max(change_order.order_number), 0) + 1
  into next_order_number
  from public.project_change_orders change_order
  where change_order.project_id = p_project_id;

  insert into public.project_change_orders (
    organization_id, project_id, order_number, title, description, amount,
    line_items, contract_time_adjustment_days, status, created_by
  ) values (
    project_organization_id, p_project_id, next_order_number, normalized_title,
    null, total_amount, p_line_items,
    p_contract_time_adjustment_days, 'draft', actor_id
  )
  returning project_change_orders.id into new_change_order_id;

  return query select new_change_order_id, next_order_number;
end;
$$;

revoke all on function public.create_project_change_order(uuid, jsonb, integer) from public;
grant execute on function public.create_project_change_order(uuid, jsonb, integer) to authenticated;
