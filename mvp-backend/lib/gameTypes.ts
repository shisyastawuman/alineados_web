import type { GameMetrics } from './metrics.js';

export type { GameMetrics, MetricKey } from './metrics.js';

export type Role = 'LEADER' | 'PARTICIPANT' | 'SPECTATOR';

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
