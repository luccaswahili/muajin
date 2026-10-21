revoke execute on function public.is_member() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.has_perm(text) from public, anon;
revoke execute on function public.require_perm(text) from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_perm(text) to authenticated;
grant execute on function public.require_perm(text) to authenticated;
