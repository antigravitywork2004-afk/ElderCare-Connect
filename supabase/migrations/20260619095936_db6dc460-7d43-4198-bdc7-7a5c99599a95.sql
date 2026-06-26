
REVOKE ALL ON FUNCTION public.detect_care_issues() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_care_issues() TO postgres, service_role;
