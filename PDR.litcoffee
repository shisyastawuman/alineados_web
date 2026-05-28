# WEB ALINEADOS - MVP v1.0

## 1. Definición del Producto
- **Objetivo principal:** [Resolver problema X para el usuario Y]
- **Métricas de éxito (KPIs):** 
- **Stack Tecnológico:** [Ej: Next.js, Node.js, PostgreSQL, AWS]

## 2. Roles de Usuario (Actores)
1. `Player - Leader`: Jugador autenticado cuyas decisiones afectan la historia.
2. `Player - Participante`: Jugador autenticado cuyas decisiones sólo se registran y busca anticipar las decisiones del líder.
3. `Admin`: Director de la jugada, accede a todos los datos y maneja el flujo de la jugada.
4. `Público`: Vista general del juego donde se comparte sólo información pública para todos.

## 3. Matriz de Épicas y User Stories (Scope MVP)
> Formato: Como [Rol], quiero [Acción] para [Valor/Resultado].

### Epic 1: Creación de partida y join de usuarios
- [x] **US-1.1:** Como `Admin`, quiero ingresar al creador de partidas para crear una partida con un código único.
- [x] **US-1.2:** Como `Player - Leader`, quiero ingresar a la partida mediante el código para unirme como el único jugador de tipo líder.
- [x] **US-1.3:** Como `Player - Participante`, quiero ingresar a la partida mediante el código para unirme como jugador de tipo random.
- [x] **US-1.4:** Como `Público`, quiero ingresar a la partida mediante el código para visualizar la partida pública.
- [x] **US-1.5:** Como `Admin`, quiero recibir confirmación de cuando haya al menos 1 líder y al menos 1 random para dar inicio a la partida.

### Epic 2: Registro y visualización de elecciones individuales
- [x] **US-2.1:** Como `Admin`, quiero avanzar a la siguiente situación para que los jugadores visualicen las opciones y voten.
- [x] **US-2.2:** Como `Player - Leader`/`Player - Participante`, quiero poder visualizar de forma alternada la situación, las opciones y el estado de juego para tomar mi decisión con toda la información.
- [x] **US-2.3:** Como `Player - Leader`/`Player - Participante`, quiero elegir mi preferencia para que quede registrada en relación a mi usuario.
- [x] **US-2.4:** Como `Player - Leader`/`Player - Participante`, quiero visualizar qué preferencia elegí para no tener que recordarlo.
- [x] **US-2.5:** Como `Player - Leader`/`Player - Participante`, quiero deshacer mi elección para volver a elegir otra vez.
- [x] **US-2.6:** Como `Público`, quiero saber cuando todos eligieron su preferencia.
- [x] **US-2.7:** Como `Admin`, quiero saber la preferencia de los jugadores (mínimo la del líder) para decidir cuándo avanzar la jugada.
- [x] **US-2.8:** Como `Admin`, quiero poder editar las elecciones de los jugadores para habilitar cambios por arrepentimiento de los jugadores.
- [x] **US-2.9:** Como `Admin`, quiero poder confirmar que las elecciones no requieren más modificaciones antes de pasar al registro de anticipación.

### Epic 3: Registro y validación de anticipación grupo al líder
- [x] **US-3.1:** Como `Admin`, quiero elegir qué opción el grupo anticipa que eligió el líder para revelar si coinciden o no y registrar dicha coincidencia.
- [x] **US-3.2:** Como `Público`, quiero saber si hubo o no coincidencia y cuántas coincidencias van en relación a la cantidad de situaciones jugadas.

### Epic 4: Impacto y visualización de consecuencias sobre el estado de juego
- [x] **US-4.1:** Como `Admin`, quiero avanzar a la fase de consecuencias para afectar el estado del juego en base a la elección del líder.
- [x] **US-4.2:** Como `Público`, quiero visualizar el estado del juego para identificar qué cambió en base a la elección del líder.

### Epic 5: Conclusión de partina, visualización de ending y métricas finales
- [x] **US-5.1:** Como `Admin`, quiero avanzar a la siguiente situación o terminar el juego si ya no quedan situaciones.
- [x] **US-5.2:** Como `Público`, quiero visualizar el ending obtenido y las métricas finales de estado de juego y alineación para evaluar cómo resultó la partida.

### Epic 6: Configuración de partida
- [x] **US-6.1:** Como `Admin`, quiero poder agregar situaciones nuevas y que queden guardadas.
- [x] **US-6.2:** Como `Admin`, quiero configurar la partida para elegir qué situaciones aparecerán y en qué orden.
- [x] **US-6.3:** Como `Admin`, quiero seleccionar una opción para que las situaciones aparezcan de forma randomizada.

## 4. Out of Scope (Excluido de v1)
- [Listado explícito de features rechazadas para el MVP para evitar scope creep. Ej: Login social con OAuth, Notificaciones Push].