-- Ejecutar UNA VEZ antes de desplegar la API v2. Conserva cuentas y recolecciones.
BEGIN;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'recolector';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='usuarios_rol_valido' AND conrelid='public.usuarios'::regclass) THEN
  ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_valido CHECK (rol IN ('recolector','administrador'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS recolecciones_usuario_id_id_idx ON public.recolecciones(usuario_id,id);
COMMIT;
