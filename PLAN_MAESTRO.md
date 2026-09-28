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
| 5 | Historial y registro manual de publicaciones | Código local; migración confirmada como ejecutada en Supabase (captura `Success`) |
| 6 | Preferencias, recomendador determinista y dashboard real | En curso: migración, algoritmo, pruebas y configuración integrados localmente; pendiente aplicar `20260925000800_recommendations.sql` y cerrar verificación |
| 7 | Generación de copy con IA | Implementada localmente; pendiente migración, clave del proveedor y verificación final |
| 8 | Calendario interno y campañas | Pendiente |
| 9 | Ideas y analítica operativa | Pendiente |
| 10 | OAuth y conexiones con Meta | Pendiente |
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
- [ ] Verificar en Supabase el flujo de escritura, reintento y lectura con RLS.
- [ ] Publicar código y migración juntos en `main` al cierre del cambio.

## Próxima fase: recomendador

**Fase 6 depende de la Fase 5.** Persistir preferencias por usuario para cantidad diaria, días mínimos de repetición y objetivos flexibles por categoría. Después implementar un scoring determinista que use el historial, evite repeticiones y explique por qué recomienda cada publicación. La IA y Meta quedan fuera de esta fase.

## Fase 6: avance y cierre

- [x] Guardar cantidad diaria, descanso mínimo, periodo de equilibrio y preferencias de categoría con RLS por usuario.
- [x] Elegir contenido elegible de forma determinista, evitando publicaciones programadas hoy y usos recientes; ponderar equilibrio, prioridad y variedad de etiquetas.
- [x] Mostrar recomendaciones explicadas en Inicio y permitir ajustar las reglas en Configuración.
- [x] Añadir pruebas unitarias del algoritmo.
- [ ] Aplicar `20260925000800_recommendations.sql` en Supabase y comprobar lectura/escritura con RLS.
- [ ] Verificar manualmente Inicio y Configuración con una cuenta con datos.
- [ ] Cerrar lint, typecheck, pruebas y build; publicar el conjunto al final en `main` según la instrucción del usuario.

## Fase 7: generación de copy con IA

- [x] Crear una pantalla integrada para brief, plataformas, tres variantes, edición y revisión humana.
- [x] Guardar una variante revisada como borrador usando el RPC existente de publicaciones.
- [x] Registrar intentos, variantes, tokens y estado; restringir lectura a cada usuario.
- [x] Aplicar cuota mensual atómica de 30 generaciones por usuario y evitar acceso anónimo a funciones.
- [x] Cubrir validación de respuestas estructuradas con pruebas unitarias.
- [ ] Aplicar `20260928000100_ai_copy_generation.sql` en Supabase y verificar cuota/RLS con dos usuarios.
- [ ] Configurar `OPENAI_API_KEY` como variable privada en Vercel; probar éxito, cuota del proveedor, timeout y respuesta inválida.
- [ ] Ejecutar lint, typecheck, pruebas y build; publicar junto con las migraciones al cierre en `main`.

## Orden de trabajo

No comenzar una fase si falta una dependencia de datos de la anterior. Para cada fase, cerrar el flujo de extremo a extremo, verificar aislamiento entre usuarios y mantener el trabajo en la rama `main` como fuente única al publicarlo.
