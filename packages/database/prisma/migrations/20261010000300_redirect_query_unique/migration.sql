-- Legacy WordPress permalinks such as /?p=6 and /?p=7 share the path "/" and differ only by query string, so uniqueness is (path, query).
DROP INDEX IF EXISTS "redirects_fromPath_key";
CREATE UNIQUE INDEX "redirects_from_path_query_key" ON "redirects" ("fromPath", COALESCE("fromQuery", ''));
