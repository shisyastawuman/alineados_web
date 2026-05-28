interface LobbyViewProps {
  room: any;
  myPlayerInfo: any;
  onStartGame: () => void;
  isLoading: boolean;
  error: string;
}

export default function LobbyView({
  room,
  myPlayerInfo,
  onStartGame,
  isLoading,
  error
}: LobbyViewProps) {
  const leaderCount = room.players.filter((p: any) => p.role === 'LEADER').length;
  const randomCount = room.players.filter((p: any) => p.role === 'PARTICIPANT').length;
  const isReady = leaderCount > 0 && randomCount > 0;

  return (
    <div style={{ padding: '2rem' }}>
      <h2>Sala: {room.code}</h2>
      <p>
        Mi Rol: <strong>{myPlayerInfo.role}</strong> ({myPlayerInfo.username})
      </p>

      {error && (
        <div style={{ color: 'red', border: '1px solid red', padding: '0.5rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <h3>Jugadores Conectados:</h3>
      <ul>
        {room.players.map((p: any) => (
          <li key={p.id}>
            [{p.role}] {p.username}
          </li>
        ))}
      </ul>

      {/* ✨ NEW: Ready indicator and start button (US-1.5) */}
      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: isReady ? '#e8f5e9' : '#fff3e0', border: `2px solid ${isReady ? '#4caf50' : '#ff9800'}` }}>
        <p>
          <strong>Fase de juego:</strong> Líder: {leaderCount} | Participante: {randomCount}
        </p>
        {isReady ? (
          <button
            onClick={onStartGame}
            disabled={isLoading}
            style={{ backgroundColor: '#4caf50', color: 'white', padding: '0.5rem 1rem', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
          >
            {isLoading ? 'Iniciando...' : '🎮 Comenzar Juego'}
          </button>
        ) : (
          <p style={{ color: '#ff9800' }}>Se necesita al menos 1 Líder y 1 Participante para comenzar.</p>
        )}
      </div>
    </div>
  );
}