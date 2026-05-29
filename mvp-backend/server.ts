import express, { type Request, type Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appendFinishedGame, getGameById, listGamesForAdmin } from './lib/finishedGamesStore.js';
import { buildGameAnalytics } from './lib/analytics.js';
import { buildAnalyticsPdfBuffer } from './lib/reportPdf.js';
import {
  createDefaultMetrics,
  hasDefeatMetrics,
  type GameMetrics,
  type MetricKey
} from './lib/metrics.js';
import {
  applyResolvedOutcomeToMetrics,
  parseSituationOption,
  resolveSituationOption,
  type SituationOption
} from './lib/situationOptions.js';

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const app = express();
app.use(cors({ credentials: true, origin: CLIENT_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

type Role = 'LEADER' | 'PARTICIPANT' | 'SPECTATOR';
type RoomStatus = 'LOBBY' | 'VOTING' | 'RESULTS' | 'ANTICIPATION' | 'CONSEQUENCES' | 'END' | 'WIN' | 'LOSE';
interface Player {
  id: string;
  username: string;
  role: Role;
}

interface Situation {
  id: string;
  title: string;
  description: string;
  options: SituationOption[];
}

interface RoundHistory {
  situationId: string;
  situationTitle?: string;
  leaderChoice: string | null;
  predictedChoice: string | null;
  isAligned: boolean;
  consequenceText: string;
  playerVotes?: { playerId: string; username: string; role: Role; optionId: string | null }[];
}

interface Room {
  code: string;
  adminId: string;
  status: RoomStatus;
  players: Player[];
  situationLibrary: Situation[];
  configuredSituationIds: string[];
  randomizeSituations: boolean;
  situations: Situation[];
  currentSituationIndex: number;
  choices: Map<string, string>;
  currentPredictedOptionId: string | null;
  currentLeaderChoiceOptionId: string | null;
  currentAnticipationCorrect: boolean | null;
  currentConsequenceText: string | null;
  currentMetricImpact: {
    metricKey: MetricKey;
    delta: number;
    previousValue: number;
    updatedValue: number;
  } | null;
  metrics: GameMetrics;
  initialMetrics: GameMetrics;
  alignmentHits: number;
  roundHistory: RoundHistory[];
  // Players are removed from the room after a short grace period to allow temporary
  // network failures / browser refreshes without breaking the game.
  connectedPlayerIds: Set<string>;
  // Timers keyed by playerId, used for delayed removal on disconnect.
  disconnectRemovalTimers: Map<string, NodeJS.Timeout>;
  lastFinishedGameId: string | null;
}

const situationsPath = path.join(process.cwd(), 'situations.json');

const loadSituations = (): Situation[] => {
  const data = fs.readFileSync(situationsPath, 'utf-8');
  const config = JSON.parse(data) as { situations: unknown[] };
  return config.situations.map((rawSituation) => {
    const validated = validateSituationPayload(rawSituation);
    if (!validated.valid) {
      throw new Error(`situations.json inválido: ${validated.error}`);
    }
    return validated.situation;
  });
};

const dbRooms = new Map<string, Room>();
const PLAYER_DISCONNECT_GRACE_MS = Number(process.env.PLAYER_DISCONNECT_GRACE_MS ?? 30 * 60 * 1000); // 30 minutes

const shuffleArray = <T,>(items: T[]): T[] => {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    const temp = cloned[i]!;
    cloned[i] = cloned[randomIndex]!;
    cloned[randomIndex] = temp;
  }
  return cloned;
};

const saveSituations = (situations: Situation[]): void => {
  fs.writeFileSync(situationsPath, `${JSON.stringify({ situations }, null, 2)}\n`, 'utf-8');
};

const syncCatalogAcrossRooms = (catalog: Situation[]): void => {
  const catalogById = new Map(catalog.map((situation) => [situation.id, situation]));
  for (const room of dbRooms.values()) {
    room.situationLibrary = catalog;
    room.configuredSituationIds = room.configuredSituationIds.filter((situationId) => catalogById.has(situationId));
    if (room.configuredSituationIds.length === 0 && catalog.length > 0) {
      const firstSituation = catalog[0];
      if (firstSituation) {
        room.configuredSituationIds = [firstSituation.id];
      }
    }
    if (room.status === 'LOBBY') {
      room.situations = resolveConfiguredSituations(room, false);
      emitRoomUpdate(room);
    }
  }
};

const validateSituationPayload = (payload: unknown): { valid: true; situation: Situation } | { valid: false; error: string } => {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Situación inválida.' };
  }

  const { id, title, description, options } = payload as Partial<Situation>;
  if (!id || !title || !description || !Array.isArray(options) || options.length < 2) {
    return { valid: false, error: 'La situación debe incluir id, título, descripción y al menos 2 opciones.' };
  }

  const parsedOptions: SituationOption[] = [];
  for (const option of options) {
    const parsed = parseSituationOption(option);
    if (!parsed.ok) {
      return { valid: false, error: parsed.error };
    }
    parsedOptions.push(parsed.option);
  }

  return {
    valid: true,
    situation: {
      id: String(id),
      title: String(title),
      description: String(description),
      options: parsedOptions
    }
  };
};

const resolveConfiguredSituations = (room: Room, randomize: boolean): Situation[] => {
  const byId = new Map(room.situationLibrary.map((situation) => [situation.id, situation]));
  const ordered = room.configuredSituationIds
    .map((situationId) => byId.get(situationId))
    .filter((situation): situation is Situation => Boolean(situation));
  return randomize ? shuffleArray(ordered) : ordered;
};

const getRoomOr404 = (code: string, res: Response): Room | null => {
  const room = dbRooms.get(code);
  if (!room) {
    res.status(404).json({ error: 'La sala no existe.' });
    return null;
  }
  return room;
};

const getCodeFromParams = (codeParam: string | string[] | undefined): string | null => {
  if (!codeParam) return null;
  return Array.isArray(codeParam) ? (codeParam[0] ?? null) : codeParam;
};

const validateAdmin = (room: Room, adminId: string | undefined, res: Response): boolean => {
  if (!adminId || room.adminId !== adminId) {
    res.status(403).json({ error: 'Acción permitida solo para Admin.' });
    return false;
  }
  return true;
};

const getCurrentSituation = (room: Room): Situation | null => {
  return room.situations[room.currentSituationIndex] ?? null;
};

const getLeaderChoice = (room: Room): string | null => {
  const leader = room.players.find((p) => p.role === 'LEADER');
  if (!leader) return null;
  return room.choices.get(leader.id) ?? null;
};

const getVotingPlayers = (room: Room): Player[] => {
  return room.players.filter((p) => p.role !== 'SPECTATOR');
};

const isAllVoted = (room: Room): boolean => {
  const votingPlayers = getVotingPlayers(room);
  return votingPlayers.length > 0 && votingPlayers.every((p) => room.choices.has(p.id));
};

const isTerminalRoomStatus = (status: RoomStatus): boolean => {
  return status === 'END' || status === 'WIN' || status === 'LOSE';
};

const finalizeGame = (room: Room, outcome: 'WIN' | 'LOSE'): void => {
  room.status = outcome;
  const record = appendFinishedGame({
    roomCode: room.code,
    adminId: room.adminId,
    players: room.players.map((player) => ({ ...player })),
    initialMetrics: { ...room.initialMetrics },
    finalMetrics: { ...room.metrics },
    alignmentHits: room.alignmentHits,
    roundHistory: room.roundHistory.map((round) => ({
      situationId: round.situationId,
      situationTitle: round.situationTitle || round.situationId,
      leaderChoice: round.leaderChoice,
      predictedChoice: round.predictedChoice,
      isAligned: round.isAligned,
      consequenceText: round.consequenceText,
      playerVotes: (round.playerVotes ?? []).map((vote) => ({ ...vote }))
    }))
  });
  room.lastFinishedGameId = record.id;
};

const getChoicesByPlayer = (room: Room) => {
  return room.players
    .filter((player) => player.role !== 'SPECTATOR')
    .map((player) => ({
      playerId: player.id,
      username: player.username,
      role: player.role,
      optionId: room.choices.get(player.id) ?? null
    }));
};

const getRoomData = (room: Room, viewerPlayerId?: string, includeChoicesByPlayer = false) => {
  const myChoice = viewerPlayerId ? room.choices.get(viewerPlayerId) ?? null : null;
  return {
    code: room.code,
    status: room.status,
    players: room.players,
    currentSituation: getCurrentSituation(room),
    currentSituationIndex: room.currentSituationIndex,
    totalSituations: room.situations.length,
    voteCount: room.choices.size,
    totalVotingPlayers: getVotingPlayers(room).length,
    allVoted: isAllVoted(room),
    myChoice,
    currentPredictedOptionId: room.currentPredictedOptionId,
    currentLeaderChoiceOptionId: room.currentLeaderChoiceOptionId,
    currentAnticipationCorrect: room.currentAnticipationCorrect,
    currentConsequenceText: room.currentConsequenceText,
    currentMetricImpact: room.currentMetricImpact,
    metrics: room.metrics,
    alignmentHits: room.alignmentHits,
    roundHistory: room.roundHistory.map((entry) => {
      const base = {
        situationId: entry.situationId,
        situationTitle: entry.situationTitle ?? entry.situationId,
        leaderChoice: entry.leaderChoice,
        predictedChoice: entry.predictedChoice,
        isAligned: entry.isAligned,
        consequenceText: entry.consequenceText
      };
      if (!includeChoicesByPlayer) return base;
      return { ...base, playerVotes: entry.playerVotes ?? [] };
    }),
    choicesByPlayer: includeChoicesByPlayer ? getChoicesByPlayer(room) : undefined,
    situationLibrary: includeChoicesByPlayer ? room.situationLibrary : undefined,
    configuredSituationIds: includeChoicesByPlayer ? room.configuredSituationIds : undefined,
    randomizeSituations: includeChoicesByPlayer ? room.randomizeSituations : undefined,
    ...(includeChoicesByPlayer && isTerminalRoomStatus(room.status)
      ? { lastFinishedGameId: room.lastFinishedGameId ?? null }
      : {})
  };
};

const emitRoomUpdate = (room: Room): void => {
  void (async () => {
    const sockets = await io.in(room.code).fetchSockets();
    for (const socket of sockets) {
      const session = socket.data as { playerId?: string; adminId?: string };
      const viewerPlayerId = session.playerId;
      const includeChoicesByPlayer = Boolean(session.adminId && session.adminId === room.adminId);
      socket.emit('room_state_updated', getRoomData(room, viewerPlayerId, includeChoicesByPlayer));
    }
  })();
};

io.on('connection', (socket) => {
  socket.on('join_network_room', (payload: { roomCode: string; playerId?: string; adminId?: string }) => {
    socket.join(payload.roomCode);
    socket.data = { roomCode: payload.roomCode, playerId: payload.playerId, adminId: payload.adminId };

    if (payload.playerId) {
      const room = dbRooms.get(payload.roomCode);
      if (room) {
        room.connectedPlayerIds.add(payload.playerId);
        // If this player was scheduled for removal, cancel it on reconnect.
        const pendingTimer = room.disconnectRemovalTimers.get(payload.playerId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          room.disconnectRemovalTimers.delete(payload.playerId);
        }
      }
    }
  });

  socket.on('disconnect', () => {
    const session = socket.data as { roomCode?: string; playerId?: string };
    if (!session?.roomCode || !session.playerId) return;

    const room = dbRooms.get(session.roomCode);
    if (!room) return;

    const playerId = session.playerId;
    const roomCode = session.roomCode;
    room.connectedPlayerIds.delete(playerId);

    // Delay actual removal so a brief disconnect (wifi drop / refresh / socket reconnect)
    // doesn't destroy the room state.
    const existingTimer = room.disconnectRemovalTimers.get(playerId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      const latestRoom = dbRooms.get(roomCode);
      if (!latestRoom) return;
      if (latestRoom.connectedPlayerIds.has(playerId)) return; // reconnected

      latestRoom.players = latestRoom.players.filter((p) => p.id !== playerId);
      latestRoom.choices.delete(playerId);
      latestRoom.disconnectRemovalTimers.delete(playerId);

      if (latestRoom.players.length === 0) {
        dbRooms.delete(roomCode);
        return;
      }

      emitRoomUpdate(latestRoom);
    }, PLAYER_DISCONNECT_GRACE_MS);

    room.disconnectRemovalTimers.set(playerId, timer);
  });
});

app.post('/api/rooms', (_req: Request, res: Response) => {
  const baseSituations = loadSituations();
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const adminId = crypto.randomUUID();
  const newRoom: Room = {
    code,
    adminId,
    status: 'LOBBY',
    players: [],
    situationLibrary: baseSituations,
    configuredSituationIds: baseSituations.map((situation) => situation.id),
    randomizeSituations: false,
    situations: baseSituations,
    currentSituationIndex: 0,
    choices: new Map(),
    currentPredictedOptionId: null,
    currentLeaderChoiceOptionId: null,
    currentAnticipationCorrect: null,
    currentConsequenceText: null,
    currentMetricImpact: null,
    metrics: createDefaultMetrics(),
    initialMetrics: createDefaultMetrics(),
    alignmentHits: 0,
    roundHistory: [],
    connectedPlayerIds: new Set(),
    disconnectRemovalTimers: new Map(),
    lastFinishedGameId: null
  };

  dbRooms.set(code, newRoom);
  res.status(201).json({ message: 'Sala creada', roomCode: code, adminId, room: getRoomData(newRoom) });
});

app.get('/api/situations', (_req: Request, res: Response): void => {
  const situations = loadSituations();
  res.status(200).json({ situations });
});

app.post('/api/situations', (req: Request, res: Response): void => {
  const { situation } = req.body as { situation?: unknown };
  const validation = validateSituationPayload(situation);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const persisted = loadSituations();
  if (persisted.some((existing) => existing.id === validation.situation.id)) {
    res.status(409).json({ error: 'Ya existe una situación con ese id.' });
    return;
  }

  const updatedCatalog = [...persisted, validation.situation];
  saveSituations(updatedCatalog);
  syncCatalogAcrossRooms(updatedCatalog);
  res.status(201).json({ message: 'Situación creada', situations: updatedCatalog });
});

app.put('/api/situations/:id', (req: Request, res: Response): void => {
  const id = getCodeFromParams(req.params.id);
  const { situation } = req.body as { situation?: unknown };
  if (!id) {
    res.status(400).json({ error: 'Id inválido.' });
    return;
  }

  const validation = validateSituationPayload(situation);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }
  if (validation.situation.id !== id) {
    res.status(400).json({ error: 'El id del path debe coincidir con el id de la situación.' });
    return;
  }

  const persisted = loadSituations();
  const existingIndex = persisted.findIndex((existing) => existing.id === id);
  if (existingIndex < 0) {
    res.status(404).json({ error: 'No existe la situación a editar.' });
    return;
  }

  const updatedCatalog = [...persisted];
  updatedCatalog[existingIndex] = validation.situation;
  saveSituations(updatedCatalog);
  syncCatalogAcrossRooms(updatedCatalog);
  res.status(200).json({ message: 'Situación actualizada', situations: updatedCatalog });
});

app.post('/api/rooms/join', (req: Request, res: Response): void => {
  const code = String(req.body.code ?? '');
  const role = String(req.body.role ?? '') as Role;
  const username = String(req.body.username ?? '').trim();

  if (!code || !username || !['LEADER', 'PARTICIPANT', 'SPECTATOR'].includes(role)) {
    res.status(400).json({ error: 'Datos inválidos para unirse a la sala.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;

  if (room.status !== 'LOBBY') {
    res.status(409).json({ error: 'La sala ya comenzó.' });
    return;
  }

  if (role === 'LEADER' && room.players.some((p) => p.role === 'LEADER')) {
    res.status(409).json({ error: 'La sala ya tiene un líder.' });
    return;
  }

  const newPlayer: Player = { id: crypto.randomUUID(), username, role };
  room.players.push(newPlayer);
  room.connectedPlayerIds.add(newPlayer.id);
  emitRoomUpdate(room);

  res.status(200).json({ message: 'Ingreso exitoso', player: newPlayer, room: getRoomData(room, newPlayer.id) });
});

app.get('/api/rooms/:code', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'Código de sala inválido.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;

  const viewerPlayerId = req.query.playerId ? String(req.query.playerId) : undefined;
  const adminId = req.query.adminId ? String(req.query.adminId) : undefined;
  const includeChoicesByPlayer = Boolean(adminId && adminId === room.adminId);
  res.status(200).json({ room: getRoomData(room, viewerPlayerId, includeChoicesByPlayer) });
});

app.post('/api/rooms/:code/start', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId } = req.body as { adminId?: string };
  if (!code) {
    res.status(400).json({ error: 'Código de sala inválido.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;

  if (room.status !== 'LOBBY') {
    res.status(409).json({ error: 'La sala ya comenzó o terminó.' });
    return;
  }

  const hasLeader = room.players.some((p) => p.role === 'LEADER');
  const hasParticipante = room.players.some((p) => p.role === 'PARTICIPANT');
  if (!hasLeader || !hasParticipante) {
    res.status(409).json({ error: 'Se necesita al menos 1 Líder y 1 Participante para comenzar.' });
    return;
  }

  const configuredSituations = resolveConfiguredSituations(room, room.randomizeSituations);
  if (configuredSituations.length === 0) {
    res.status(409).json({ error: 'Configurá al menos una situación para iniciar la partida.' });
    return;
  }

  room.status = 'VOTING';
  room.situations = configuredSituations;
  room.currentSituationIndex = 0;
  room.choices.clear();
  room.currentPredictedOptionId = null;
  room.currentLeaderChoiceOptionId = null;
  room.currentAnticipationCorrect = null;
  room.currentConsequenceText = null;
  room.currentMetricImpact = null;
  room.metrics = createDefaultMetrics();
  room.initialMetrics = createDefaultMetrics();

  emitRoomUpdate(room);
  res.status(200).json({ message: 'Juego comenzado', room: getRoomData(room) });
});

app.post('/api/rooms/:code/vote', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { playerId, optionId } = req.body as { playerId?: string; optionId?: string };
  if (!code || !playerId || !optionId) {
    res.status(400).json({ error: 'Datos inválidos para votar.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (room.status !== 'VOTING') {
    res.status(409).json({ error: 'La sala no está en fase de votación.' });
    return;
  }

  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    res.status(404).json({ error: 'Jugador no encontrado.' });
    return;
  }
  if (player.role === 'SPECTATOR') {
    res.status(403).json({ error: 'El público no puede votar.' });
    return;
  }

  const currentSituation = getCurrentSituation(room);
  if (!currentSituation) {
    res.status(409).json({ error: 'No hay situación activa.' });
    return;
  }

  const validOption = currentSituation.options.some((opt) => opt.id === optionId);
  if (!validOption) {
    res.status(400).json({ error: 'Opción inválida.' });
    return;
  }

  room.choices.set(playerId, optionId);
  emitRoomUpdate(room);

  res.status(200).json({ message: 'Voto registrado', room: getRoomData(room, playerId) });
});

app.post('/api/rooms/:code/unvote', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { playerId } = req.body as { playerId?: string };
  if (!code || !playerId) {
    res.status(400).json({ error: 'Datos inválidos para deshacer voto.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (room.status !== 'VOTING') {
    res.status(409).json({ error: 'Solo se puede deshacer en fase de votación.' });
    return;
  }

  const player = room.players.find((currentPlayer) => currentPlayer.id === playerId);
  if (!player || player.role === 'SPECTATOR') {
    res.status(403).json({ error: 'Solo jugadores pueden deshacer voto.' });
    return;
  }

  room.choices.delete(playerId);
  emitRoomUpdate(room);
  res.status(200).json({ message: 'Voto deshecho', room: getRoomData(room, playerId) });
});

app.post('/api/rooms/:code/admin/configure-situations', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId, configuredSituationIds, randomizeSituations } = req.body as {
    adminId?: string;
    configuredSituationIds?: string[];
    randomizeSituations?: boolean;
  };
  if (!code || !Array.isArray(configuredSituationIds) || configuredSituationIds.length === 0) {
    res.status(400).json({ error: 'Debés enviar al menos una situación configurada.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;
  if (room.status !== 'LOBBY') {
    res.status(409).json({ error: 'La configuración de situaciones solo se permite en LOBBY.' });
    return;
  }

  const validIds = new Set(room.situationLibrary.map((situation) => situation.id));
  const hasInvalidIds = configuredSituationIds.some((situationId) => !validIds.has(situationId));
  if (hasInvalidIds) {
    res.status(400).json({ error: 'La configuración incluye ids de situaciones inválidos.' });
    return;
  }

  room.configuredSituationIds = configuredSituationIds;
  room.randomizeSituations = Boolean(randomizeSituations);
  room.situations = resolveConfiguredSituations(room, false);
  emitRoomUpdate(room);
  res.status(200).json({ message: 'Configuración guardada', room: getRoomData(room, undefined, true) });
});

app.post('/api/rooms/:code/admin/add-situation', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId, situation } = req.body as { adminId?: string; situation?: unknown };
  if (!code) {
    res.status(400).json({ error: 'Código de sala inválido.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;
  if (room.status !== 'LOBBY') {
    res.status(409).json({ error: 'Solo se pueden agregar situaciones antes de iniciar la partida.' });
    return;
  }

  const validation = validateSituationPayload(situation);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  if (room.situationLibrary.some((existing) => existing.id === validation.situation.id)) {
    res.status(409).json({ error: 'Ya existe una situación con ese id.' });
    return;
  }

  const persisted = loadSituations();
  if (persisted.some((existing) => existing.id === validation.situation.id)) {
    res.status(409).json({ error: 'Ya existe una situación con ese id en el catálogo.' });
    return;
  }

  const updatedCatalog = [...persisted, validation.situation];
  saveSituations(updatedCatalog);
  syncCatalogAcrossRooms(updatedCatalog);

  res.status(200).json({ message: 'Situación agregada', room: getRoomData(room, undefined, true) });
});

app.post('/api/rooms/:code/admin/edit-choice', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId, targetPlayerId, optionId } = req.body as {
    adminId?: string;
    targetPlayerId?: string;
    optionId?: string | null;
  };

  if (!code || !targetPlayerId) {
    res.status(400).json({ error: 'Datos inválidos para editar voto.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;
  if (room.status !== 'VOTING') {
    res.status(409).json({ error: 'Solo se pueden editar votos en fase de votación.' });
    return;
  }

  const currentSituation = getCurrentSituation(room);
  if (!currentSituation) {
    res.status(409).json({ error: 'No hay situación activa.' });
    return;
  }

  if (optionId == null) {
    room.choices.delete(targetPlayerId);
  } else {
    const validOption = currentSituation.options.some((opt) => opt.id === optionId);
    if (!validOption) {
      res.status(400).json({ error: 'Opción inválida.' });
      return;
    }
    room.choices.set(targetPlayerId, optionId);
  }

  emitRoomUpdate(room);
  res.status(200).json({ message: 'Voto actualizado por Admin', room: getRoomData(room, undefined, true) });
});

app.post('/api/rooms/:code/admin/confirm-votes', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId } = req.body as { adminId?: string };
  if (!code) {
    res.status(400).json({ error: 'Código de sala inválido.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;
  if (room.status !== 'VOTING') {
    res.status(409).json({ error: 'La sala no está en votación.' });
    return;
  }

  if (!isAllVoted(room)) {
    res.status(409).json({ error: 'No se puede confirmar: faltan votos de algún jugador.' });
    return;
  }

  room.status = 'RESULTS';
  room.currentLeaderChoiceOptionId = getLeaderChoice(room);
  room.currentPredictedOptionId = null;
  room.currentAnticipationCorrect = null;
  emitRoomUpdate(room);
  res.status(200).json({ message: 'Votación confirmada', room: getRoomData(room, undefined, true) });
});

app.post('/api/rooms/:code/admin/anticipation', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId, predictedOptionId } = req.body as { adminId?: string; predictedOptionId?: string };
  if (!code || !predictedOptionId) {
    res.status(400).json({ error: 'Datos inválidos para anticipación.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;
  if (room.status !== 'RESULTS') {
    res.status(409).json({ error: 'La anticipación solo puede registrarse desde RESULTS.' });
    return;
  }

  const leaderChoice = getLeaderChoice(room);
  room.currentLeaderChoiceOptionId = leaderChoice;
  room.currentPredictedOptionId = predictedOptionId;
  room.currentAnticipationCorrect = leaderChoice !== null && leaderChoice === predictedOptionId;
  room.status = 'ANTICIPATION';

  if (room.currentAnticipationCorrect) {
    room.alignmentHits += 1;
  }

  emitRoomUpdate(room);
  res.status(200).json({ message: 'Anticipación registrada', room: getRoomData(room, undefined, true) });
});

app.post('/api/rooms/:code/admin/apply-consequence', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId } = req.body as { adminId?: string };
  if (!code) {
    res.status(400).json({ error: 'Código de sala inválido.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;
  if (room.status !== 'ANTICIPATION') {
    res.status(409).json({ error: 'Las consecuencias solo se aplican desde ANTICIPATION.' });
    return;
  }

  const currentSituation = getCurrentSituation(room);
  const leaderChoice = getLeaderChoice(room);
  const leaderOption = currentSituation?.options.find((opt) => opt.id === leaderChoice) ?? null;

  if (leaderOption) {
    const outcome = resolveSituationOption(leaderOption, room.metrics);
    room.metrics = applyResolvedOutcomeToMetrics(room.metrics, outcome);
    room.currentConsequenceText = outcome.narrative;
    room.currentMetricImpact =
      outcome.metricKey && outcome.previousValue != null && outcome.updatedValue != null
        ? {
            metricKey: outcome.metricKey,
            delta: outcome.delta,
            previousValue: outcome.previousValue,
            updatedValue: outcome.updatedValue
          }
        : null;
  } else {
    room.currentMetricImpact = null;
    room.currentConsequenceText = 'Sin elección del líder: no se aplicaron consecuencias.';
  }

  const historyItem: RoundHistory = {
    situationId: currentSituation?.id ?? `situation-${room.currentSituationIndex}`,
    situationTitle: currentSituation?.title ?? '',
    leaderChoice,
    predictedChoice: room.currentPredictedOptionId,
    isAligned: leaderChoice !== null && leaderChoice === room.currentPredictedOptionId,
    consequenceText: room.currentConsequenceText,
    playerVotes: getChoicesByPlayer(room)
  };
  room.roundHistory.push(historyItem);
  room.status = 'CONSEQUENCES';
  emitRoomUpdate(room);
  res.status(200).json({ message: 'Consecuencia aplicada', room: getRoomData(room, undefined, true) });
});

app.post('/api/rooms/:code/admin/next', (req: Request, res: Response): void => {
  const code = getCodeFromParams(req.params.code);
  const { adminId } = req.body as { adminId?: string };
  if (!code) {
    res.status(400).json({ error: 'Código de sala inválido.' });
    return;
  }

  const room = getRoomOr404(code, res);
  if (!room) return;
  if (!validateAdmin(room, adminId, res)) return;
  if (isTerminalRoomStatus(room.status)) {
    res.status(409).json({ error: 'La partida ya finalizó.' });
    return;
  }
  if (room.status !== 'CONSEQUENCES') {
    res.status(409).json({ error: 'Solo se puede avanzar desde CONSEQUENCES.' });
    return;
  }

  if (hasDefeatMetrics(room.metrics)) {
    finalizeGame(room, 'LOSE');
    emitRoomUpdate(room);
    res.status(200).json({ message: 'Derrota: una métrica cayó por debajo de 0', room: getRoomData(room, undefined, true) });
    return;
  }

  const nextSituationIndex = room.currentSituationIndex + 1;
  if (nextSituationIndex >= room.situations.length) {
    finalizeGame(room, 'WIN');
  } else {
    room.currentSituationIndex = nextSituationIndex;
    room.status = 'VOTING';
    room.choices.clear();
    room.currentPredictedOptionId = null;
    room.currentLeaderChoiceOptionId = null;
    room.currentAnticipationCorrect = null;
    room.currentConsequenceText = null;
    room.currentMetricImpact = null;
  }

  emitRoomUpdate(room);
  res.status(200).json({ message: 'Se avanzó de fase', room: getRoomData(room, undefined, true) });
});

app.get('/api/admin/finished-games', (req: Request, res: Response): void => {
  const adminId = String(req.query.adminId ?? '');
  if (!adminId) {
    res.status(400).json({ error: 'adminId requerido.' });
    return;
  }
  const games = listGamesForAdmin(adminId).map((game) => ({
    id: game.id,
    roomCode: game.roomCode,
    finishedAt: game.finishedAt,
    totalRounds: game.roundHistory.length,
    alignmentHits: game.alignmentHits
  }));
  res.status(200).json({ games });
});

app.get('/api/admin/finished-games/:gameId/analytics', (req: Request, res: Response): void => {
  const gameId = getCodeFromParams(req.params.gameId);
  const adminId = String(req.query.adminId ?? '');
  if (!gameId || !adminId) {
    res.status(400).json({ error: 'Parámetros inválidos.' });
    return;
  }
  const game = getGameById(gameId);
  if (!game || game.adminId !== adminId) {
    res.status(404).json({ error: 'Partida no encontrada.' });
    return;
  }
  res.status(200).json({ analytics: buildGameAnalytics(game) });
});

app.get('/api/admin/finished-games/:gameId/report.pdf', async (req: Request, res: Response): Promise<void> => {
  const gameId = getCodeFromParams(req.params.gameId);
  const adminId = String(req.query.adminId ?? '');
  if (!gameId || !adminId) {
    res.status(400).json({ error: 'Parámetros inválidos.' });
    return;
  }
  const game = getGameById(gameId);
  if (!game || game.adminId !== adminId) {
    res.status(404).json({ error: 'Partida no encontrada.' });
    return;
  }
  try {
    const analytics = buildGameAnalytics(game);
    const buffer = await buildAnalyticsPdfBuffer(analytics);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="alineados-${game.roomCode}.pdf"`);
    res.status(200).send(buffer);
  } catch (pdfError) {
    console.error('[report.pdf]', pdfError);
    res.status(500).json({ error: 'No se pudo generar el PDF.' });
  }
});

httpServer.listen(PORT, () => {
  console.log(`[Backend] Servidor HTTP/WS corriendo en puerto ${PORT}`);
});