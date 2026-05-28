interface Option {
  id: string;
  label: string;
}

interface Situation {
  title: string;
  description: string;
  options: Option[];
}

interface VotingViewProps {
  situation: Situation;
  myChoice: string | null;
  onVote: (optionId: string) => void;
  onUndoVote: () => void;
  voteCount: number;
  totalPlayers: number;
  error: string;
}

export default function VotingView({
  situation,
  myChoice,
  onVote,
  onUndoVote,
  voteCount,
  totalPlayers,
  error
}: VotingViewProps) {
  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h2>{situation.title}</h2>
      <p>{situation.description}</p>

      {error && (
        <div style={{ color: 'red', border: '1px solid red', padding: '0.5rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* ✨ NEW: Vote options (US-2.3) */}
      <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {situation.options.map((option: Option) => (
          <button
            key={option.id}
            onClick={() => onVote(option.id)}
            style={{
              padding: '1rem',
              fontSize: '16px',
              border: myChoice === option.id ? '3px solid #2196f3' : '1px solid #ccc',
              borderRadius: '4px',
              backgroundColor: myChoice === option.id ? '#e3f2fd' : '#fff',
              cursor: 'pointer',
              fontWeight: myChoice === option.id ? 'bold' : 'normal'
            }}
          >
            {myChoice === option.id && '✓ '} {option.label}
          </button>
        ))}
      </div>

      {/* ✨ NEW: Vote controls (US-2.4, US-2.5) */}
      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <div style={{ marginBottom: '1rem' }}>
          <strong>Tu elección:</strong> {myChoice ? 'Seleccionada ✓' : 'Pendiente...'}
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <small>Votos registrados: {voteCount} / {totalPlayers}</small>
        </div>
        <button
          onClick={onUndoVote}
          disabled={!myChoice}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: myChoice ? '#ff5252' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: myChoice ? 'pointer' : 'not-allowed'
          }}
        >
          ↺ Deshacer Elección
        </button>
      </div>
    </div>
  );
}