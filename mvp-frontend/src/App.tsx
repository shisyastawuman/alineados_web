import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const socket = io(API_BASE_URL);

type Role = 'LEADER' | 'PARTICIPANT' | 'SPECTATOR';
type RoomStatus = 'LOBBY' | 'VOTING' | 'RESULTS' | 'ANTICIPATION' | 'CONSEQUENCES' | 'END';
type MetricKey = 'stressLeader' | 'performance' | 'relationship' | 'stressJunior';

interface Player {
  id: string;
  username: string;
  role: Role;
}

interface Option {
  id: string;
  label: string;
  metricKey: MetricKey;
  delta: number;
}

interface Situation {
  id: string;
  title: string;
  description: string;
  options: Option[];
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

interface RoomView {
  code: string;
  status: RoomStatus;
  players: Player[];
  currentSituation: Situation | null;
  currentSituationIndex: number;
  totalSituations: number;
  voteCount: number;
  totalVotingPlayers: number;
  allVoted: boolean;
  myChoice: string | null;
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
  metrics: Record<MetricKey, number>;
  alignmentHits: number;
  roundHistory: RoundHistory[];
  lastFinishedGameId?: string | null;
  choicesByPlayer?: {
    playerId: string;
    username: string;
    role: 'LEADER' | 'PARTICIPANT';
    optionId: string | null;
  }[];
  situationLibrary?: Situation[];
  configuredSituationIds?: string[];
  randomizeSituations?: boolean;
}

interface FinishedGameSummary {
  id: string;
  roomCode: string;
  finishedAt: string;
  totalRounds: number;
  alignmentHits: number;
}

interface GameAnalytics {
  gameId: string;
  roomCode: string;
  finishedAt: string;
  totalRounds: number;
  alignmentCorrectCount: number;
  alignmentPct: number | null;
  outcomeSuccess: boolean;
  initialMetrics: Record<MetricKey, number>;
  finalMetrics: Record<MetricKey, number>;
  nonLeaderPlayers: {
    playerId: string;
    username: string;
    role: string;
    pctRoundsMatchingLeader: number | null;
    pctRoundsMatchingOthersMajority: number | null;
  }[];
  situations: {
    situationIndex: number;
    situationId: string;
    situationTitle: string;
    alignmentCorrect: boolean;
    shareMatchingLeader: number | null;
    overHalfPlayersMatchedLeader: boolean | null;
  }[];
}

interface SessionState {
  roomCode: string;
  adminId: string | null;
  playerId: string | null;
  role: Role | null;
  username: string | null;
}

interface SituationOptionForm {
  id: string;
  label: string;
  metricKey: MetricKey;
  delta: string;
}

const FIXED_OPTION_IDS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

const createDefaultSituationOptions = (): SituationOptionForm[] => [
  { id: 'A', label: '', metricKey: 'stressLeader', delta: '0' },
  { id: 'B', label: '', metricKey: 'performance', delta: '0' },
  { id: 'C', label: '', metricKey: 'relationship', delta: '0' },
  { id: 'D', label: '', metricKey: 'stressJunior', delta: '0' }
];

const getLowestAvailableSituationId = (catalog: Situation[]): string => {
  const used = new Set<number>();
  for (const situation of catalog) {
    const match = /^sit_(\d+)$/i.exec(situation.id.trim());
    if (match?.[1]) used.add(Number(match[1]));
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return `sit_${String(next).padStart(3, '0')}`;
};

const emptySession: SessionState = {
  roomCode: '',
  adminId: null,
  playerId: null,
  role: null,
  username: null
};

const SESSION_STORAGE_PREFIX = 'alineados_session_v1:';
const LAST_ADMIN_STORAGE_KEY = 'alineados_last_admin_id';
const getSessionStorageKey = (roomCode: string): string => `${SESSION_STORAGE_PREFIX}${roomCode}`;

const metricLabels: Record<MetricKey, string> = {
  stressLeader: 'Estrés del líder',
  performance: 'Performance del líder',
  relationship: 'Vínculo con el líder',
  stressJunior: 'Estrés de los juniors'
};

export default function App() {
  const [session, setSession] = useState<SessionState>(emptySession);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [predictedOptionId, setPredictedOptionId] = useState('');
  const [editingChoicePlayerId, setEditingChoicePlayerId] = useState('');
  const [editingChoiceOptionId, setEditingChoiceOptionId] = useState('');
  const [pendingOptionId, setPendingOptionId] = useState('');
  const [playersMinimized, setPlayersMinimized] = useState(true);
  const [statsViewOpen, setStatsViewOpen] = useState(false);
  const [impactPulse, setImpactPulse] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [roomLink, setRoomLink] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [invitedRoomCode, setInvitedRoomCode] = useState('');
  const [adminHomePanel, setAdminHomePanel] = useState<'setup' | 'history' | 'historyDetail'>('setup');
  const [adminIdForHistory, setAdminIdForHistory] = useState('');
  const [finishedGameSummaries, setFinishedGameSummaries] = useState<FinishedGameSummary[]>([]);
  const [selectedFinishedGameId, setSelectedFinishedGameId] = useState<string | null>(null);
  const [gameAnalyticsDetail, setGameAnalyticsDetail] = useState<GameAnalytics | null>(null);
  const [roomEndAnalytics, setRoomEndAnalytics] = useState<GameAnalytics | null>(null);
  const [situationCatalog, setSituationCatalog] = useState<Situation[]>([]);
  const [editingSituationId, setEditingSituationId] = useState<string | null>(null);
  const [situationIdInput, setSituationIdInput] = useState('');
  const [situationTitleInput, setSituationTitleInput] = useState('');
  const [situationDescriptionInput, setSituationDescriptionInput] = useState('');
  const [situationOptionsInput, setSituationOptionsInput] = useState<SituationOptionForm[]>([
    ...createDefaultSituationOptions()
  ]);

  const isAdmin = Boolean(session.adminId);
  const me = useMemo(() => room?.players.find((p) => p.id === session.playerId) ?? null, [room, session.playerId]);
  const leaderChoiceLabel = useMemo(() => {
    if (!room?.currentSituation || !room.currentLeaderChoiceOptionId) return null;
    return room.currentSituation.options.find((opt) => opt.id === room.currentLeaderChoiceOptionId)?.label ?? null;
  }, [room?.currentLeaderChoiceOptionId, room?.currentSituation]);

  const apiRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${path}`, init);
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Error inesperado');
    return data;
  };

  const resetSituationForm = () => {
    setEditingSituationId(null);
    setSituationIdInput(getLowestAvailableSituationId(situationCatalog));
    setSituationTitleInput('');
    setSituationDescriptionInput('');
    setSituationOptionsInput(createDefaultSituationOptions());
  };

  const loadSituationCatalog = async () => {
    const data = await apiRequest<{ situations: Situation[] }>('/api/situations');
    setSituationCatalog(data.situations);
  };

  const loadRoom = async (roomCode: string, viewerPlayerId?: string | null, adminId?: string | null) => {
    const params = new URLSearchParams();
    if (viewerPlayerId) params.set('playerId', viewerPlayerId);
    if (adminId) params.set('adminId', adminId);
    const query = params.toString() ? `?${params.toString()}` : '';
    const data = await apiRequest<{ room: RoomView }>(`/api/rooms/${roomCode}${query}`);
    setRoom(data.room);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromQuery = params.get('room');
    const pathMatch = window.location.pathname.match(/^\/room\/([A-Za-z0-9_-]+)$/);
    const roomFromPath = pathMatch?.[1] ?? null;
    const roomCodeFromUrl = roomFromPath ?? roomFromQuery;
    if (roomCodeFromUrl) {
      const normalizedCode = roomCodeFromUrl.toUpperCase();
      setInvitedRoomCode(normalizedCode);
      setRoomCodeInput(normalizedCode);
      setRoomLink(`${window.location.origin}/room/${normalizedCode}`);

      // If the user refreshed / lost wifi, try to restore their previous identity for this room.
      try {
        const saved = localStorage.getItem(getSessionStorageKey(normalizedCode));
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<SessionState>;
          setSession({
            roomCode: normalizedCode,
            adminId: parsed.adminId ?? null,
            playerId: parsed.playerId ?? null,
            role: (parsed.role ?? null) as Role | null,
            username: parsed.username ?? null
          });
        }
      } catch {
        // Ignore localStorage parse errors.
      }
    }
  }, []);

  useEffect(() => {
    if (invitedRoomCode || session.roomCode) return;
    void loadSituationCatalog();
    try {
      const storedAdmin = localStorage.getItem(LAST_ADMIN_STORAGE_KEY);
      if (storedAdmin) setAdminIdForHistory(storedAdmin);
    } catch {
      // ignore
    }
  }, [invitedRoomCode, session.roomCode]);

  useEffect(() => {
    if (editingSituationId) return;
    setSituationIdInput(getLowestAvailableSituationId(situationCatalog));
  }, [situationCatalog, editingSituationId]);

  useEffect(() => {
    if (!session.roomCode) return;
    try {
      localStorage.setItem(getSessionStorageKey(session.roomCode), JSON.stringify(session));
    } catch {
      // Ignore localStorage failures (private mode, quota, etc).
    }
  }, [session]);

  useEffect(() => {
    const onRoomUpdate = (payload: RoomView) => {
      setRoom(payload);
    };

    socket.on('room_state_updated', onRoomUpdate);
    return () => {
      socket.off('room_state_updated', onRoomUpdate);
    };
  }, []);

  useEffect(() => {
    if (!session.roomCode) return;

    const emitJoin = () => {
      socket.emit('join_network_room', {
        roomCode: session.roomCode,
        playerId: session.playerId ?? undefined,
        adminId: session.adminId ?? undefined
      });
    };

    if (socket.connected) emitJoin();
    socket.on('connect', emitJoin);

    return () => {
      socket.off('connect', emitJoin);
    };
  }, [session.roomCode, session.playerId, session.adminId]);

  useEffect(() => {
    if (!session.roomCode) return;
    const sync = async () => {
      try {
        await loadRoom(session.roomCode, session.playerId, session.adminId);
      } catch (syncError: unknown) {
        setError(syncError instanceof Error ? syncError.message : 'Error sincronizando sala');
      }
    };
    void sync();
    const interval = setInterval(() => void sync(), 5000);
    return () => clearInterval(interval);
  }, [session.roomCode, session.playerId, session.adminId]);

  useEffect(() => {
    if (room?.currentMetricImpact) {
      setImpactPulse(true);
      const timer = window.setTimeout(() => setImpactPulse(false), 1500);
      return () => window.clearTimeout(timer);
    }
  }, [room?.currentMetricImpact]);

  useEffect(() => {
    if (room?.status !== 'END' || !isAdmin || !session.adminId || !room.lastFinishedGameId) {
      setRoomEndAnalytics(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiRequest<{ analytics: GameAnalytics }>(
          `/api/admin/finished-games/${room.lastFinishedGameId}/analytics?adminId=${encodeURIComponent(session.adminId!)}`
        );
        if (!cancelled) setRoomEndAnalytics(data.analytics);
      } catch {
        if (!cancelled) setRoomEndAnalytics(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room?.status, room?.lastFinishedGameId, isAdmin, session.adminId]);

  useEffect(() => {
    // Lobby should be clean for players/leaders: no metrics panel.
    if (room?.status === 'LOBBY' && !isAdmin) setStatsViewOpen(false);
  }, [room?.status, isAdmin]);

  const createRoomAsAdmin = async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ roomCode: string; adminId: string; room: RoomView }>('/api/rooms', { method: 'POST' });
      try {
        localStorage.setItem(LAST_ADMIN_STORAGE_KEY, data.adminId);
      } catch {
        // ignore
      }
      setAdminIdForHistory(data.adminId);
      setSession({ roomCode: data.roomCode, adminId: data.adminId, playerId: null, role: null, username: 'Admin' });
      setRoomCodeInput(data.roomCode);
      setRoomLink(`${window.location.origin}/room/${data.roomCode}`);
      setRoom(data.room);
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear la sala');
    } finally {
      setIsLoading(false);
    }
  };

  const joinAsRole = async (role: Role) => {
    if (!roomCodeInput.trim() || !usernameInput.trim()) {
      setError('Completá nombre para unirte');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const roomCode = roomCodeInput.trim().toUpperCase();
      const data = await apiRequest<{ player: Player; room: RoomView }>('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: roomCode, role, username: usernameInput.trim() })
      });
      setSession({ roomCode, adminId: null, playerId: data.player.id, role: data.player.role, username: data.player.username });
      window.history.replaceState(null, '', `/room/${roomCode}`);
      setRoom(data.room);
      setPendingOptionId('');
    } catch (joinError: unknown) {
      setError(joinError instanceof Error ? joinError.message : 'No se pudo unir a la sala');
    } finally {
      setIsLoading(false);
    }
  };

  const postAdminAction = async (path: string, extraBody?: Record<string, unknown>) => {
    if (!session.adminId) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ room: RoomView }>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: session.adminId, ...(extraBody ?? {}) })
      });
      setRoom(data.room);
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'No se pudo completar acción');
    } finally {
      setIsLoading(false);
    }
  };

  const vote = async () => {
    if (!session.playerId || !pendingOptionId) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ room: RoomView }>(`/api/rooms/${session.roomCode}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: session.playerId, optionId: pendingOptionId })
      });
      setRoom(data.room);
      setPendingOptionId('');
    } catch (voteError: unknown) {
      setError(voteError instanceof Error ? voteError.message : 'No se pudo registrar voto');
    } finally {
      setIsLoading(false);
    }
  };

  const unvote = async () => {
    if (!session.playerId) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ room: RoomView }>(`/api/rooms/${session.roomCode}/unvote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: session.playerId })
      });
      setRoom(data.room);
      setPendingOptionId('');
    } catch (unvoteError: unknown) {
      setError(unvoteError instanceof Error ? unvoteError.message : 'No se pudo deshacer voto');
    } finally {
      setIsLoading(false);
    }
  };

  const copyInviteLink = async () => {
    if (!roomLink) return;
    try {
      await navigator.clipboard.writeText(roomLink);
      setCopyFeedback('Link copiado');
    } catch {
      setCopyFeedback('No se pudo copiar automáticamente');
    }
    window.setTimeout(() => setCopyFeedback(''), 1800);
  };

  const refreshFinishedGamesList = async () => {
    const trimmed = adminIdForHistory.trim();
    if (!trimmed) {
      setError('Ingresá tu Admin ID (se guarda automáticamente al crear una sala).');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ games: FinishedGameSummary[] }>(
        `/api/admin/finished-games?adminId=${encodeURIComponent(trimmed)}`
      );
      setFinishedGameSummaries(data.games);
    } catch (listErr: unknown) {
      setError(listErr instanceof Error ? listErr.message : 'No se pudo cargar el historial');
    } finally {
      setIsLoading(false);
    }
  };

  const openAdminHistoryPanel = () => {
    setAdminHomePanel('history');
    setGameAnalyticsDetail(null);
    setSelectedFinishedGameId(null);
    void refreshFinishedGamesList();
  };

  const openFinishedGameDetail = async (gameId: string) => {
    const trimmed = adminIdForHistory.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ analytics: GameAnalytics }>(
        `/api/admin/finished-games/${gameId}/analytics?adminId=${encodeURIComponent(trimmed)}`
      );
      setSelectedFinishedGameId(gameId);
      setGameAnalyticsDetail(data.analytics);
      setAdminHomePanel('historyDetail');
    } catch (detailErr: unknown) {
      setError(detailErr instanceof Error ? detailErr.message : 'No se pudo cargar la analítica');
    } finally {
      setIsLoading(false);
    }
  };

  const downloadSelectedFinishedGamePdf = () => {
    if (!selectedFinishedGameId || !adminIdForHistory.trim()) return;
    const url = `${API_BASE_URL}/api/admin/finished-games/${selectedFinishedGameId}/report.pdf?adminId=${encodeURIComponent(adminIdForHistory.trim())}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const reorderConfiguredSituations = (targetId: string, direction: 'up' | 'down') => {
    if (!room?.configuredSituationIds?.length) return;
    const current = [...room.configuredSituationIds];
    const index = current.indexOf(targetId);
    if (index < 0) return;
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= current.length) return;
    [current[index], current[swapWith]] = [current[swapWith], current[index]];
    void postAdminAction(`/api/rooms/${session.roomCode}/admin/configure-situations`, {
      configuredSituationIds: current,
      randomizeSituations: room.randomizeSituations ?? false
    });
  };

  const toggleSituation = (situationId: string) => {
    if (!room?.configuredSituationIds) return;
    const selected = new Set(room.configuredSituationIds);
    if (selected.has(situationId)) selected.delete(situationId);
    else selected.add(situationId);

    const ordered = (room.situationLibrary ?? []).map((situation) => situation.id).filter((id) => selected.has(id));
    if (ordered.length === 0) {
      setError('Debe quedar al menos una situación seleccionada');
      return;
    }
    void postAdminAction(`/api/rooms/${session.roomCode}/admin/configure-situations`, {
      configuredSituationIds: ordered,
      randomizeSituations: room.randomizeSituations ?? false
    });
  };

  const toggleRandomizeSituations = () => {
    if (!room?.configuredSituationIds?.length) return;
    void postAdminAction(`/api/rooms/${session.roomCode}/admin/configure-situations`, {
      configuredSituationIds: room.configuredSituationIds,
      randomizeSituations: !(room.randomizeSituations ?? false)
    });
  };

  const addSituation = async () => {
    const trimmedId = situationIdInput.trim();
    const trimmedTitle = situationTitleInput.trim();
    const trimmedDescription = situationDescriptionInput.trim();
    const parsedOptions = situationOptionsInput
      .map((option) => ({
        id: option.id.trim(),
        label: option.label.trim(),
        metricKey: option.metricKey,
        delta: Number(option.delta)
      }));

    if (!trimmedId || !trimmedTitle || !trimmedDescription) {
      setError('Completá id, título y descripción.');
      return;
    }
    if (parsedOptions.some((option) => !option.label)) {
      setError('Cada opción A/B/C/D necesita un texto.');
      return;
    }
    if (parsedOptions.some((option) => Number.isNaN(option.delta))) {
      setError('Todos los impactos (delta) deben ser numéricos.');
      return;
    }

    const situationPayload = {
      id: trimmedId,
      title: trimmedTitle,
      description: trimmedDescription,
      options: parsedOptions
    };

    setIsLoading(true);
    setError('');
    try {
      if (editingSituationId) {
        await apiRequest<{ situations: Situation[] }>(`/api/situations/${editingSituationId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ situation: situationPayload })
        });
      } else {
        await apiRequest<{ situations: Situation[] }>('/api/situations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ situation: situationPayload })
        });
      }
      await loadSituationCatalog();
      resetSituationForm();
    } catch (addError: unknown) {
      setError(addError instanceof Error ? addError.message : 'No se pudo guardar la situación');
    } finally {
      setIsLoading(false);
    }
  };

  const editSituationFromCatalog = (situation: Situation) => {
    const optionsById = new Map(situation.options.map((option) => [option.id, option]));
    setEditingSituationId(situation.id);
    setSituationIdInput(situation.id);
    setSituationTitleInput(situation.title);
    setSituationDescriptionInput(situation.description);
    setSituationOptionsInput(
      FIXED_OPTION_IDS.map((optionId) => {
        const option = optionsById.get(optionId);
        return {
          id: optionId,
          label: option?.label ?? '',
          metricKey: option?.metricKey ?? 'relationship',
          delta: String(option?.delta ?? 0)
        };
      })
    );
  };

  const updateSituationOptionField = (
    index: number,
    key: keyof SituationOptionForm,
    value: string | MetricKey
  ) => {
    setSituationOptionsInput((prev) => prev.map((option, currentIndex) => (currentIndex === index ? { ...option, [key]: value } : option)));
  };

  const renderStatsPanel = () => {
    if (!room) return null;
    return (
      <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
        <h2>Estado del juego</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: '0.75rem' }}>
          {(Object.keys(room.metrics) as MetricKey[]).map((key) => (
            <div key={key} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.6rem' }}>
              <strong>{metricLabels[key]}</strong>
              <div style={{ fontSize: '1.2rem' }}>{room.metrics[key]}</div>
            </div>
          ))}
        </div>
        {room.currentMetricImpact && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.7rem',
              border: '2px solid #2563eb',
              borderRadius: 6,
              background: impactPulse ? '#dbeafe' : '#eff6ff',
              transform: impactPulse ? 'scale(1.02)' : 'scale(1)',
              transition: 'all 250ms ease'
            }}
          >
            <strong>{metricLabels[room.currentMetricImpact.metricKey]}</strong>{' '}
            {room.currentMetricImpact.delta > 0 ? `+${room.currentMetricImpact.delta}` : room.currentMetricImpact.delta} (
            {room.currentMetricImpact.previousValue} {'->'} {room.currentMetricImpact.updatedValue})
          </div>
        )}
      </section>
    );
  };

  const renderAnalyticsDashboard = (analytics: GameAnalytics, options?: { showPdfDownload?: boolean }) => {
    const maxMetric = Math.max(1, ...((Object.keys(metricLabels) as MetricKey[]).map((key) => Math.abs(analytics.finalMetrics[key]))));
    return (
      <div style={{ display: 'grid', gap: '1rem' }}>
        <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
          <h2>Resumen</h2>
          <p>
            Alineación correcta: <strong>{analytics.alignmentCorrectCount}</strong> de <strong>{analytics.totalRounds}</strong>
            {analytics.alignmentPct != null && (
              <> ({analytics.alignmentPct.toFixed(1)}%)</>
            )}
          </p>
          <p>
            Resultado de partida: <strong>{analytics.outcomeSuccess ? 'Éxito' : 'Fracaso'}</strong> (umbral: mayoría de rondas con anticipación correcta).
          </p>
          <p>Finalizada: {new Date(analytics.finishedAt).toLocaleString('es-AR')}</p>
          {options?.showPdfDownload && (
            <button type="button" onClick={downloadSelectedFinishedGamePdf} disabled={!selectedFinishedGameId}>
              Descargar reporte PDF
            </button>
          )}
        </section>
        <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
          <h2>Métricas inicial → final</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {(Object.keys(metricLabels) as MetricKey[]).map((key) => (
              <div key={key} style={{ border: '1px solid #eee', borderRadius: 6, padding: '0.6rem' }}>
                <strong>{metricLabels[key]}</strong>
                <div>{analytics.initialMetrics[key]} → {analytics.finalMetrics[key]}</div>
              </div>
            ))}
          </div>
        </section>
        <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
          <h2>Participantes (no líder)</h2>
          {analytics.nonLeaderPlayers.length === 0 ? (
            <p>No hay datos de participantes.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Jugador</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>% coincidencias con líder</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>% coincidencias con mayoría</th>
                </tr>
              </thead>
              <tbody>
                {analytics.nonLeaderPlayers.map((player) => (
                  <tr key={player.playerId}>
                    <td style={{ borderBottom: '1px solid #eee' }}>{player.username}</td>
                    <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                      {player.pctRoundsMatchingLeader != null ? `${player.pctRoundsMatchingLeader.toFixed(1)}%` : 'N/D'}
                    </td>
                    <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>
                      {player.pctRoundsMatchingOthersMajority != null ? `${player.pctRoundsMatchingOthersMajority.toFixed(1)}%` : 'N/D'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
          <h2>Por situación</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>#</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Situación</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Anticipación</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>% coincidencias con líder</th>
              </tr>
            </thead>
            <tbody>
              {analytics.situations.map((row) => (
                <tr key={`${row.situationId}-${row.situationIndex}`}>
                  <td style={{ borderBottom: '1px solid #eee' }}>{row.situationIndex}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>{row.situationTitle}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>{row.alignmentCorrect ? 'Correcta' : 'Incorrecta'}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>
                    {row.shareMatchingLeader != null ? `${row.shareMatchingLeader.toFixed(1)}%` : 'N/D'}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee' }}>
                    {row.overHalfPlayersMatchedLeader === null ? 'N/D' : row.overHalfPlayersMatchedLeader ? 'Sí' : 'No'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  };

  if (!session.roomCode) {
    if (!invitedRoomCode) {
      const adminToolbar = (
        <>
          <label style={{ display: 'grid', gap: '0.35rem' }}>
            Admin ID
            <input
              value={adminIdForHistory}
              onChange={(event) => setAdminIdForHistory(event.target.value)}
              placeholder="Se guarda al crear una sala"
              style={{ width: '100%', maxWidth: '520px' }}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => { setAdminHomePanel('setup'); setGameAnalyticsDetail(null); }} disabled={adminHomePanel === 'setup'}>
              Inicio admin
            </button>
            <button type="button" onClick={openAdminHistoryPanel} disabled={!adminIdForHistory.trim()}>
              Historial de partidas
            </button>
          </div>
        </>
      );

      if (adminHomePanel === 'history') {
        return (
          <div style={{ padding: '2rem', maxWidth: '980px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
            <h1>ALINEADOS — Historial</h1>
            {adminToolbar}
            {error && <div style={{ border: '1px solid #b91c1c', color: '#b91c1c', padding: '0.75rem' }}>{error}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setAdminHomePanel('setup')}>Volver</button>
              <button type="button" onClick={() => void refreshFinishedGamesList()} disabled={isLoading}>Refrescar listado</button>
            </div>
            {finishedGameSummaries.length === 0 ? (
              <p>No hay partidas finalizadas guardadas para este admin.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Sala</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Fecha</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Rondas</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>Aciertos anticipación</th>
                    <th style={{ borderBottom: '1px solid #ccc' }} />
                  </tr>
                </thead>
                <tbody>
                  {finishedGameSummaries.map((game) => (
                    <tr key={game.id}>
                      <td style={{ borderBottom: '1px solid #eee' }}><code>{game.roomCode}</code></td>
                      <td style={{ borderBottom: '1px solid #eee' }}>{new Date(game.finishedAt).toLocaleString('es-AR')}</td>
                      <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>{game.totalRounds}</td>
                      <td style={{ textAlign: 'right', borderBottom: '1px solid #eee' }}>{game.alignmentHits}</td>
                      <td style={{ borderBottom: '1px solid #eee' }}>
                        <button type="button" onClick={() => void openFinishedGameDetail(game.id)}>Ver analítica</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      }

      if (adminHomePanel === 'historyDetail' && gameAnalyticsDetail) {
        return (
          <div style={{ padding: '2rem', maxWidth: '980px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
            <h1>ALINEADOS — Analítica de partida</h1>
            {adminToolbar}
            {error && <div style={{ border: '1px solid #b91c1c', color: '#b91c1c', padding: '0.75rem' }}>{error}</div>}
            <button type="button" onClick={() => { setAdminHomePanel('history'); setGameAnalyticsDetail(null); }}>Volver al listado</button>
            {renderAnalyticsDashboard(gameAnalyticsDetail, { showPdfDownload: true })}
          </div>
        );
      }

      return (
        <div style={{ padding: '2rem', maxWidth: '980px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
          <h1>ALINEADOS - Admin</h1>
          {adminToolbar}
          {error && <div style={{ border: '1px solid #b91c1c', color: '#b91c1c', padding: '0.75rem' }}>{error}</div>}
          <p>Primero podés crear partida o administrar el catálogo de situaciones.</p>
          <button onClick={createRoomAsAdmin} disabled={isLoading}>{isLoading ? 'Procesando...' : 'Crear sala como Admin'}</button>
          <section style={{ border: '1px solid #ddd', padding: '1rem', display: 'grid', gap: '0.75rem' }}>
            <h2>{editingSituationId ? 'Editar situación' : 'Nueva situación'}</h2>
            <p style={{ margin: 0, fontSize: '0.92rem', color: '#334155' }}>
              Guía: el id se asigna automáticamente con el formato <code>sit_XXX</code> (número disponible más bajo).
              Cada situación tiene siempre 4 opciones fijas (A, B, C, D), con texto, métrica y delta numérico.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: '0.7rem' }}>
              <label>
                Id de situación
                <input
                  value={situationIdInput}
                  readOnly
                  disabled
                  style={{ width: '100%' }}
                />
              </label>
              <label>
                Título
                <input
                  value={situationTitleInput}
                  onChange={(event) => setSituationTitleInput(event.target.value)}
                  placeholder="Encuentro con cliente clave"
                  style={{ width: '100%' }}
                />
              </label>
            </div>
            <label>
              Descripción
              <textarea
                value={situationDescriptionInput}
                onChange={(event) => setSituationDescriptionInput(event.target.value)}
                placeholder="Contexto y dilema que deben resolver líder/participantes."
                rows={3}
                style={{ width: '100%' }}
              />
            </label>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <strong>Opciones fijas (A, B, C, D)</strong>
              {situationOptionsInput.map((option, index) => (
                <div
                  key={`option-form-${index}`}
                  style={{ border: '1px solid #ddd', padding: '0.6rem', borderRadius: 6, display: 'grid', gap: '0.45rem' }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 2fr 1.2fr 0.8fr', gap: '0.45rem', alignItems: 'end' }}>
                    <div>
                      <small>ID</small>
                      <div><strong>{option.id}</strong></div>
                    </div>
                    <label>
                      Texto
                      <input
                        value={option.label}
                        onChange={(event) => updateSituationOptionField(index, 'label', event.target.value)}
                        placeholder="A. Priorizo velocidad y reduzco calidad"
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      Métrica
                      <select
                        value={option.metricKey}
                        onChange={(event) => updateSituationOptionField(index, 'metricKey', event.target.value as MetricKey)}
                        style={{ width: '100%' }}
                      >
                        {(Object.keys(metricLabels) as MetricKey[]).map((metricKey) => (
                          <option key={metricKey} value={metricKey}>{metricLabels[metricKey]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Delta
                      <input
                        type="number"
                        step={1}
                        value={option.delta}
                        onChange={(event) => updateSituationOptionField(index, 'delta', event.target.value)}
                        placeholder="0"
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button onClick={addSituation} disabled={isLoading}>
                {isLoading ? 'Guardando...' : editingSituationId ? 'Guardar cambios' : 'Crear situación'}
              </button>
              <button onClick={resetSituationForm} disabled={isLoading}>Limpiar formulario</button>
              <button onClick={() => void loadSituationCatalog()} disabled={isLoading}>Refrescar catálogo</button>
            </div>
          </section>
          <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
            <h2>Situaciones cargadas ({situationCatalog.length})</h2>
            {situationCatalog.length === 0 ? (
              <p>No hay situaciones todavía.</p>
            ) : (
              <ul style={{ paddingLeft: '1.2rem', display: 'grid', gap: '0.6rem' }}>
                {situationCatalog.map((situation) => (
                  <li key={situation.id}>
                    <strong>{situation.title}</strong> <code>{situation.id}</code>
                    <div style={{ fontSize: '0.9rem', color: '#475569' }}>{situation.description}</div>
                    <button onClick={() => editSituationFromCatalog(situation)} disabled={isLoading}>Editar</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      );
    }

    return (
      <div style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
        <h1>Unirte a sala</h1>
        {error && <div style={{ border: '1px solid #b91c1c', color: '#b91c1c', padding: '0.75rem' }}>{error}</div>}
        <section style={{ border: '1px solid #ccc', padding: '1rem', textAlign: 'left' }}>
          <p>Sala: <strong>{invitedRoomCode}</strong></p>
          <input placeholder="Tu nombre" value={usernameInput} onChange={(event) => setUsernameInput(event.target.value)} />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
            <button onClick={() => joinAsRole('LEADER')} disabled={isLoading}>Unirme como Lider</button>
            <button onClick={() => joinAsRole('PARTICIPANT')} disabled={isLoading}>Unirme como Participante</button>
            <button onClick={() => joinAsRole('SPECTATOR')} disabled={isLoading}>Unirme como Publico</button>
          </div>
        </section>
      </div>
    );
  }

  if (!room) {
    return (
      <div style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
        <h1>Sincronizando sala...</h1>
        {error && <div style={{ border: '1px solid #b91c1c', color: '#b91c1c', padding: '0.75rem' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '960px', margin: '0 auto', display: 'grid', gap: '1rem', textAlign: 'left' }}>
      <h1>ALINEADOS - Sala {room.code}</h1>
      <p>Sesion: <strong>{isAdmin ? 'ADMIN' : me?.role ?? session.role}</strong> {session.username ? `(${session.username})` : ''}</p>
      <p>
        Fase de juego: <strong>{room.status}</strong>
        {!(room.status === 'LOBBY' && !isAdmin) && <> | Situacion {room.currentSituationIndex + 1}/{room.totalSituations}</>}
      </p>
      {error && <div style={{ border: '1px solid #b91c1c', color: '#b91c1c', padding: '0.75rem' }}>{error}</div>}

      {!(room.status === 'LOBBY' && !isAdmin) && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setStatsViewOpen(false)} disabled={!statsViewOpen}>Situación</button>
          <button onClick={() => setStatsViewOpen(true)} disabled={statsViewOpen}>Oficina</button>
        </div>
      )}

      {isAdmin && roomLink && (
        <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
          <h2>Link de invitacion</h2>
          <p><code>{roomLink}</code></p>
          <button onClick={copyInviteLink}>Copiar link</button>
          {copyFeedback && <p>{copyFeedback}</p>}
        </section>
      )}

      <section style={{ border: '1px solid #ddd', padding: '0.7rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Jugadores</h3>
          <button onClick={() => setPlayersMinimized((prev) => !prev)}>{playersMinimized ? 'Mostrar' : 'Minimizar'}</button>
        </div>
        {!playersMinimized && (
          <ul style={{ fontSize: '0.85rem', marginTop: '0.4rem' }}>
            {room.players.map((player) => <li key={player.id}>[{player.role}] {player.username}</li>)}
          </ul>
        )}
      </section>

      {statsViewOpen && renderStatsPanel()}
      {!statsViewOpen && (
        <>
          {room.status === 'LOBBY' && (
            <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
              <h2>Sala de espera</h2>
              {!isAdmin && <p><strong>Instruccion:</strong> espera a que el Admin inicie la partida.</p>}
              {isAdmin && (
                <div style={{ display: 'grid', gap: '0.7rem' }}>
                  <button onClick={() => postAdminAction(`/api/rooms/${session.roomCode}/start`)} disabled={isLoading}>Iniciar juego</button>
                  <section style={{ border: '1px solid #ccc', padding: '0.8rem' }}>
                    <h3>Configuracion de partida</h3>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <input
                        type="checkbox"
                        checked={room.randomizeSituations ?? false}
                        onChange={toggleRandomizeSituations}
                        disabled={isLoading}
                      />
                      Randomizar orden al iniciar
                    </label>
                    <ul style={{ marginTop: '0.7rem', paddingLeft: '1.2rem' }}>
                      {(room.situationLibrary ?? []).map((situation) => {
                        const selected = room.configuredSituationIds?.includes(situation.id) ?? false;
                        const selectedIndex = room.configuredSituationIds?.indexOf(situation.id) ?? -1;
                        return (
                          <li key={situation.id} style={{ marginBottom: '0.35rem' }}>
                            <label style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleSituation(situation.id)}
                                disabled={isLoading}
                              />
                              {situation.title} <code>{situation.id}</code>
                            </label>
                            {selected && (
                              <span style={{ marginLeft: '0.5rem' }}>
                                <button onClick={() => reorderConfiguredSituations(situation.id, 'up')} disabled={isLoading || selectedIndex <= 0}>↑</button>{' '}
                                <button
                                  onClick={() => reorderConfiguredSituations(situation.id, 'down')}
                                  disabled={isLoading || selectedIndex < 0 || selectedIndex >= (room.configuredSituationIds?.length ?? 0) - 1}
                                >
                                  ↓
                                </button>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <div style={{ marginTop: '0.7rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.6rem' }}>
                      <strong>Orden actual seleccionado</strong>
                      {(room.configuredSituationIds?.length ?? 0) === 0 ? (
                        <p style={{ margin: '0.4rem 0 0 0' }}>Sin situaciones seleccionadas.</p>
                      ) : (
                        <ol style={{ margin: '0.4rem 0 0 1.2rem' }}>
                          {(room.configuredSituationIds ?? []).map((situationId) => {
                            const situation = (room.situationLibrary ?? []).find((item) => item.id === situationId);
                            return (
                              <li key={`ordered-${situationId}`}>
                                {situation?.title ?? 'Situación'} <code>{situationId}</code>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </section>
          )}

          {room.currentSituation && room.status === 'VOTING' && (
            <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
              <h2>Votacion</h2>
              <h3>{room.currentSituation.title}</h3>
              <p>{room.currentSituation.description}</p>
              <p>Votos: {room.voteCount}/{room.totalVotingPlayers}</p>
              {!isAdmin && me?.role !== 'SPECTATOR' && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <p><strong>Instruccion:</strong> seleccioná una opción, confirmá y si querés podés deshacer para cambiar.</p>
                  {room.currentSituation.options.map((option) => {
                    const selected = room.myChoice ? room.myChoice === option.id : pendingOptionId === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() => setPendingOptionId(option.id)}
                        disabled={Boolean(room.myChoice) || isLoading}
                        style={{ border: selected ? '2px solid #2563eb' : '1px solid #ccc', padding: '0.55rem' }}
                      >
                        {selected ? '✓ ' : ''}{option.label}
                      </button>
                    );
                  })}
                  {!room.myChoice && pendingOptionId && <button onClick={vote} disabled={isLoading}>Confirmar eleccion</button>}
                  {room.myChoice && (
                    <div style={{ display: 'grid', gap: '0.45rem' }}>
                      <p>Voto confirmado.</p>
                      <button onClick={unvote} disabled={isLoading}>Deshacer eleccion</button>
                    </div>
                  )}
                </div>
              )}
              {!isAdmin && me?.role === 'SPECTATOR' && room.allVoted && <p><strong>Estado:</strong> ya votaron todos los jugadores.</p>}
              {isAdmin && (
                <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                  <h3>Votos actuales</h3>
                  <ul>{(room.choicesByPlayer ?? []).map((item) => <li key={item.playerId}>{item.username} ({item.role}): {item.optionId ?? 'Sin votar'}</li>)}</ul>
                  <select value={editingChoicePlayerId} onChange={(e) => setEditingChoicePlayerId(e.target.value)}>
                    <option value="">Seleccionar jugador</option>
                    {(room.choicesByPlayer ?? []).map((item) => <option key={item.playerId} value={item.playerId}>{item.username}</option>)}
                  </select>
                  <select value={editingChoiceOptionId} onChange={(e) => setEditingChoiceOptionId(e.target.value)}>
                    <option value="">Sin eleccion (resetear)</option>
                    {room.currentSituation.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <button
                    onClick={() =>
                      postAdminAction(`/api/rooms/${session.roomCode}/admin/edit-choice`, {
                        targetPlayerId: editingChoicePlayerId,
                        optionId: editingChoiceOptionId || null
                      })
                    }
                    disabled={isLoading || !editingChoicePlayerId}
                  >
                    Guardar edicion de voto
                  </button>
                  <button onClick={() => postAdminAction(`/api/rooms/${session.roomCode}/admin/confirm-votes`)} disabled={isLoading || !room.allVoted}>
                    Confirmar votacion
                  </button>
                </div>
              )}
            </section>
          )}

          {room.currentSituation && room.status === 'RESULTS' && (
            <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
              <h2>Anticipacion</h2>
              {isAdmin ? (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <p>Eleccion del lider: <strong>{leaderChoiceLabel ?? room.currentLeaderChoiceOptionId ?? 'Sin eleccion registrada'}</strong></p>
                  <select value={predictedOptionId} onChange={(e) => setPredictedOptionId(e.target.value)}>
                    <option value="">Selecciona opcion anticipada</option>
                    {room.currentSituation.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <button
                    onClick={() => postAdminAction(`/api/rooms/${session.roomCode}/admin/anticipation`, { predictedOptionId })}
                    disabled={isLoading || !predictedOptionId}
                  >
                    Registrar anticipacion
                  </button>
                </div>
              ) : (
                <p><strong>Instruccion:</strong> espera la anticipacion del Admin.</p>
              )}
            </section>
          )}

          {room.status === 'ANTICIPATION' && (
            <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
              <h2>Resultado anticipacion</h2>
              <p><strong>{room.currentAnticipationCorrect ? 'Correcta' : 'Incorrecta'}</strong></p>
              <p>Alineaciones acumuladas: {room.alignmentHits}/{room.roundHistory.length || room.currentSituationIndex + 1}</p>
              {isAdmin ? (
                <button onClick={() => postAdminAction(`/api/rooms/${session.roomCode}/admin/apply-consequence`)} disabled={isLoading}>
                  Avanzar a consecuencias
                </button>
              ) : (
                <p><strong>Instruccion:</strong> espera el avance del Admin.</p>
              )}
            </section>
          )}

          {room.status === 'CONSEQUENCES' && (
            <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
              <h2>Consecuencias</h2>
              <p>{room.currentConsequenceText ?? 'Consecuencia pendiente.'}</p>
              {room.currentMetricImpact && (
                <div
                  style={{
                    marginTop: '0.7rem',
                    padding: '0.7rem',
                    borderRadius: 6,
                    background: impactPulse ? '#dcfce7' : '#f0fdf4',
                    border: '2px solid #16a34a',
                    transform: impactPulse ? 'scale(1.02)' : 'scale(1)',
                    transition: 'all 250ms ease'
                  }}
                >
                  Impacto en {metricLabels[room.currentMetricImpact.metricKey]}:{' '}
                  {room.currentMetricImpact.delta > 0 ? `+${room.currentMetricImpact.delta}` : room.currentMetricImpact.delta}
                </div>
              )}
              {isAdmin ? (
                <button onClick={() => postAdminAction(`/api/rooms/${session.roomCode}/admin/next`)} disabled={isLoading}>
                  {room.currentSituationIndex + 1 >= room.totalSituations ? 'Finalizar juego' : 'Siguiente situacion'}
                </button>
              ) : (
                <p><strong>Instruccion:</strong> revisa el impacto y espera la siguiente ronda.</p>
              )}
            </section>
          )}

          {room.status === 'END' && (
            <section style={{ border: '1px solid #ddd', padding: '1rem' }}>
              <h2>Final</h2>
              <p>Alineaciones logradas: {room.alignmentHits}</p>
              <p>
                Ending:{' '}
                <strong>
                  {room.alignmentHits >= Math.ceil(room.totalSituations / 2)
                    ? 'Equipo alineado: lograron coordinar la mayoría de situaciones.'
                    : 'Equipo desalineado: hubo más desaciertos que coincidencias.'}
                </strong>
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {(Object.keys(room.metrics) as MetricKey[]).map((key) => (
                  <div key={key} style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.6rem' }}>
                    <strong>{metricLabels[key]}</strong>
                    <div style={{ fontSize: '1.2rem' }}>{room.metrics[key]}</div>
                  </div>
                ))}
              </div>
              {isAdmin && room.lastFinishedGameId && session.adminId && (
                <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `${API_BASE_URL}/api/admin/finished-games/${room.lastFinishedGameId}/report.pdf?adminId=${encodeURIComponent(session.adminId!)}`,
                        '_blank',
                        'noopener,noreferrer'
                      )
                    }
                  >
                    Descargar reporte PDF
                  </button>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>ID guardado: <code>{room.lastFinishedGameId}</code></span>
                </div>
              )}
              {isAdmin && roomEndAnalytics && (
                <div style={{ marginTop: '1.25rem' }}>
                  <h3>Analítica detallada</h3>
                  {renderAnalyticsDashboard(roomEndAnalytics)}
                </div>
              )}
              {isAdmin && !roomEndAnalytics && room.lastFinishedGameId && (
                <p style={{ marginTop: '0.75rem', color: '#64748b' }}>Cargando analítica...</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}