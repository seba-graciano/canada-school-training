# Canada School — Sistema de Gestión

Aplicación de gestión de un colegio privado: alumnos, tutores, cuotas, cobranzas, descuentos por
hermano y mora. **Proyecto de rescate / entrenamiento:** el código fue heredado de un vendor anterior
y llega en estado crítico. El objetivo es auditarlo, corregir sus problemas y profesionalizar su
arquitectura.

**Stack:** React + TypeScript + Vite + Supabase (PostgreSQL / Auth / RLS) + Tailwind CSS.

## Qué debe hacer el sistema

- **Alumnos y tutores:** alta y listado, agrupados por familia.
- **Cuotas:** matrícula anual + cuotas mensuales por alumno, con estado (pendiente/pagada/vencida).
- **Cobranzas:** registrar pagos y calcular deuda.
- **Descuentos por hermano:** 10% al 2º hijo, 20% al 3º, según la familia real.
- **Mora:** recargo por atraso respetando el 2º vencimiento.
- **Aumentos:** aplicar a cuotas pendientes sin alterar recibos ya pagados.
- **Seguridad:** acceso por rol (admin/secretaria/tutor).

Hoy el sistema "anda" en la demo feliz, pero tiene problemas de correctitud, performance, seguridad
y arquitectura que hay que encontrar y resolver.

## Cómo empezar

Alta de cuentas con selección de rol y requisitos de despliegue: [Account creation](docs/tutor-accounts.md).

Ver **[SETUP.md](./SETUP.md)**. En resumen: `npm install`, crear tu Supabase, aplicar
`supabase/`, configurar `.env` y `npm run dev`.

## Qué se espera

1. **Endurecer el código:** encontrar y corregir los defectos (muchos sólo se manifiestan bajo
   condiciones específicas: datos nulos, timing, escala, entrada inválida). Detalle del contexto y el
   reclamo del cliente en [`app/README.md`](./app/README.md).
2. **Darle arquitectura:** refactor a Clean Architecture — ver [`app/ARQUITECTURA.md`](./app/ARQUITECTURA.md).
