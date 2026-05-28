export type Role = 'LEADER' | 'PARTICIPANT' | 'SPECTATOR';
export type MetricKey = 'stressLeader' | 'performance' | 'relationship' | 'stressJunior';

export interface GameMetrics {
  stressLeader: number;
  performance: number;
  relationship: number;
  stressJunior: number;
}

export interface Player {
  id: string;
  username: string;
  role: Role;
}

export interface PlayerVoteSnapshot {
  playerId: string;
  username: string;
  role: Role;
  optionId: string | null;
}

export interface RoundHistorySnapshot {
  situationId: string;
  situationTitle: string;
  leaderChoice: string | null;
  predictedChoice: string | null;
  isAligned: boolean;
  consequenceText: string;
  playerVotes: PlayerVoteSnapshot[];
}

export interface FinishedGameRecord {
  id: string;
  roomCode: string;
  adminId: string;
  finishedAt: string;
  players: Player[];
  initialMetrics: GameMetrics;
  finalMetrics: GameMetrics;
  alignmentHits: number;
  roundHistory: RoundHistorySnapshot[];
}
