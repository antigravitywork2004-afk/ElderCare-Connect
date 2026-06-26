
REVOKE EXECUTE ON FUNCTION public.is_linked_child(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_parent(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_linked_child(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_parent(UUID) TO authenticated;
