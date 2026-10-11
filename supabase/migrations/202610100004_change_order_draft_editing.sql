create or replace function public.update_project_change_order_draft(
  p_project_id uuid,
  p_change_order_id uuid,
  p_line_items jsonb,
  p_contract_time_adjustment_days integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_order_row record;
  line_item jsonb;
  line_number integer := 0;
  total_amount numeric := 0;
  normalized_title text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to edit change orders for this project.';
  end if;

  select change_order.id, change_order.status
  into change_order_row
  from public.project_change_orders change_order
  where change_order.id = p_change_order_id
    and change_order.project_id = p_project_id
  for update;
  if not found then raise exception 'Change order was not found in this project.'; end if;
  if change_order_row.status <> 'draft' then
    raise exception 'Only draft change orders can be edited.';
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
  update public.project_change_orders
  set title = normalized_title,
      description = null,
      amount = total_amount,
      line_items = p_line_items,
      contract_time_adjustment_days = p_contract_time_adjustment_days,
      updated_at = now()
  where id = p_change_order_id and project_id = p_project_id;
end;
$$;

revoke all on function public.update_project_change_order_draft(uuid, uuid, jsonb, integer) from public;
grant execute on function public.update_project_change_order_draft(uuid, uuid, jsonb, integer) to authenticated;

notify pgrst, 'reload schema';
