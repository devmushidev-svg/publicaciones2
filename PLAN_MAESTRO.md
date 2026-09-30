# Plan maestro de norte.

## Objetivo

Construir un espacio de trabajo para crear y organizar publicaciones, registrar su uso real, recomendar contenido y, en fases posteriores, incorporar IA, analítica social e integraciones con Meta. El historial es la fuente de verdad para los usos; la biblioteca describe el contenido reutilizable.

## Estado

| Fase | Alcance | Estado |
| --- | --- | --- |
| 0 | Estabilización del proyecto | Completa |
| 1 | Supabase, perfiles y seguridad inicial | Implementada; el esquema está en uso |
| 2 | Autenticación y perfil | Completa |
| 3 | Categorías y etiquetas | Completa |
| 4 | Biblioteca y Storage | Completa |
| 5 | Historial y registro manual de publicaciones | Cerrada en código y pruebas (pgTAP + API con usuarios A/B/anónimo + UI). Pendiente: verificar en el proyecto remoto con `verify_remote_state.sql` |
| 6 | Preferencias, recomendador determinista y dashboard real | Cerrada en código y pruebas; el recomendador excluye contenido ya programado. Pendiente: confirmar `20260925000800` en el remoto |
| 7 | Generación de copy con IA | Cerrada salvo activación: falta `OPENAI_API_KEY` en Vercel y una generación real. Proveedor probado con respuestas simuladas (éxito, cuota, límite, timeout, salida inválida) |
| 8 | Calendario interno y campañas | Implementada: programar, mover (diálogo y arrastrar), cancelar, registrar uso desde la programación, campañas con vigencia y meta |
| 9 | Ideas y analítica operativa | Implementada: oportunidades explicadas con el historial, ideas ligadas a campañas y borradores, actividad real en Rendimiento |
| 10 | OAuth y conexiones con Meta | Implementada en código para Facebook Pages e Instagram profesional; falta aplicar migración y probar con una app real de Meta |
| 11 | Importación y analítica de métricas sociales | Pendiente |
| 12 | Rendimiento como señal para recomendaciones | Pendiente |
| 13 | Publicación automática | Pendiente |

## Fase 5: criterio de cierre

- [x] Registrar una ocasión manualmente desde Publicaciones o Biblioteca.
- [x] Guardar una fila por plataforma con clave idempotente compartida.
- [x] Capturar snapshots de título, copy, categoría, etiquetas e imágenes.
- [x] Consultar historial con búsqueda, plataforma, fecha y carga de páginas anteriores.
- [x] Impedir marcar una publicación como publicada sin historial.
- [x] TypeScript, ESLint y build pasan localmente.
- [x] Aplicar la migración de historial al proyecto Supabase conectado (confirmación visual del usuario).
- [x] Verificar escritura, reintento, conflicto de clave, fecha futura y RLS con usuarios A, B y anónimo (local: pgTAP y `tests/integration`).
- [ ] Ejecutar `supabase/verify_remote_state.sql` en el proyecto remoto.
- [x] Publicar código y migración juntos en `main` al cierre del cambio.

## Próxima fase: recomendador

**Fase 6 depende de la Fase 5.** Persistir preferencias por usuario para cantidad diaria, días mínimos de repetición y objetivos flexibles por categoría. Después implementar un scoring determinista que use el historial, evite repeticiones y explique por qué recomienda cada publicación. La IA y Meta quedan fuera de esta fase.

## Fase 6: avance y cierre

- [x] Guardar cantidad diaria, descanso mínimo, periodo de equilibrio y preferencias de categoría con RLS por usuario.
- [x] Elegir contenido elegible de forma determinista, evitando publicaciones programadas hoy y usos recientes; ponderar equilibrio, prioridad y variedad de etiquetas.
- [x] Mostrar recomendaciones explicadas en Inicio y permitir ajustar las reglas en Configuración.
- [x] Añadir pruebas unitarias del algoritmo.
- [x] Comprobar lectura/escritura con RLS y conversión de tipos vía PostgREST (local).
- [ ] Confirmar `20260925000800_recommendations.sql` en el remoto (esquema y registro).
- [x] Verificar Inicio con una cuenta con datos (prueba de UI con Playwright).
- [x] Lint, typecheck, pruebas y build.

## Fase 7: generación de copy con IA

- [x] Crear una pantalla integrada para brief, plataformas, tres variantes, edición y revisión humana.
- [x] Guardar una variante revisada como borrador usando el RPC existente de publicaciones.
- [x] Registrar intentos, variantes, tokens y estado; restringir lectura a cada usuario.
- [x] Aplicar cuota mensual atómica de 30 generaciones por usuario y evitar acceso anónimo a funciones.
- [x] Cubrir validación de respuestas estructuradas con pruebas unitarias.
- [x] Verificar cuota (30/mes, independiente por usuario), RLS y acceso anónimo (local).
- [x] Guardar borrador de forma atómica e idempotente (`20260928000200`); aceptar las 6 plataformas ofrecidas; cerrar intentos abandonados.
- [ ] Aplicar `20260928000100` y `20260928000200` en el remoto.
- [x] Probar éxito, cuota del proveedor, límite, timeout y respuesta inválida con un proveedor simulado.
- [ ] Configurar `OPENAI_API_KEY` como variable privada en Vercel y hacer una generación real.
- [x] Lint, typecheck, pruebas y build.

## Fase 8: calendario interno y campañas

- [x] `scheduled_posts`: una fila por intención (publicación, fecha, plataformas previstas, campaña, notas). Estados `planned`, `cancelled`, `fulfilled`. Solo lectura directa; toda escritura pasa por funciones que validan dueño, fecha futura, vigencia de campaña en la zona horaria de la cuenta y un solo plan por publicación y día local.
- [x] Crear (idempotente con id generado en el cliente), mover (diálogo o arrastrar a otro día conservando la hora local), cancelar (idempotente).
- [x] Registrar el uso desde la programación: escribe el historial con `record_my_publication_use` y marca el plan como cumplido. Una programación nunca escribe historial por sí sola; las vencidas sin registro se muestran como "pendiente de confirmar".
- [x] Campañas con inicio, fin, color, objetivo y meta opcional; no se pueden acortar dejando programaciones fuera; se archivan.
- [x] Las programaciones antiguas (`publications.status = 'scheduled'`) se migran a `scheduled_posts`; el editor ya no programa.
- [x] Archivar una publicación cancela sus programaciones pendientes.

## Fase 9: ideas y analítica operativa

- [x] Oportunidades calculadas solo con historial, calendario, biblioteca y reglas: programaciones vencidas, cobertura de la semana, ritmo real frente al objetivo, categorías por debajo de su objetivo, repeticiones, contenido que ya descansó, borradores y archivos sin usar, campañas atrasadas. Cada una explica sus datos.
- [x] Guardar una oportunidad como idea (idempotente por clave) y programar desde ella.
- [x] Ideas con campaña; conversión a borrador atómica e idempotente que enlaza la idea con su borrador.
- [x] "Actividad real" en Rendimiento: ocasiones por día frente al objetivo, equilibrio por categoría frente al objetivo, plataformas, días y horas, contenido más reutilizado y cumplimiento del calendario. Separada de "Métricas de redes", que sigue sin datos inventados.

## Fase 10: conexiones con Meta

- [x] Inicio OAuth con estado temporal, callback verificado y selección de una Página administrada.
- [x] Vincular la Página de Facebook y, si existe, su Instagram profesional. Los tokens quedan en `private`, no en la respuesta al navegador.
- [x] Desconectar, reemplazar una conexión y mostrar caducidad del token.
- [x] Impedir escritura directa en `social_connections` desde el navegador; las operaciones pasan por RPC con dueño autenticado.
- [ ] Aplicar `20260930000100_meta_connections.sql` al proyecto remoto antes de desplegar el código correspondiente.
- [ ] Configurar la app de Meta y probar el flujo real con una Página y una cuenta de Instagram profesional.
- [ ] Confirmar permisos aprobados de Meta para usuarios externos y comportamiento cuando Meta revoca el acceso.

## Orden de trabajo

No comenzar una fase si falta una dependencia de datos de la anterior. Para cada fase, cerrar el flujo de extremo a extremo, verificar aislamiento entre usuarios y mantener el trabajo en la rama `main` como fuente única al publicarlo.
